use chrono::{Duration, NaiveDate, Utc};
use gripsou_core::budget::pairing::pair_internal_transfers;
use gripsou_core::budget::vocab::CategoryKind;
use gripsou_core::dto::CanonicalAccount;
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::assign::{
    BulkChanges, Refusal, SameDescription, TransactionPatch, WriteOutcome, apply_to_description,
    bulk_apply, patch_transaction,
};
use gripsou_core::repo::budget::category::list_categories;
use gripsou_core::repo::transaction::upsert_transaction;
use gripsou_core::testkit::{checking_account, seed_user_and_connection, set_category, txn};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

type PairedRow = (Uuid, Option<Uuid>, Option<Uuid>, Option<String>);

fn account(external_id: &str, currency: &str) -> CanonicalAccount {
    CanonicalAccount {
        currency: currency.to_string(),
        ..checking_account(external_id)
    }
}

async fn tx_at(
    pool: &PgPool,
    account_id: Uuid,
    account_ext: &str,
    ext: &str,
    amount: Decimal,
    day: NaiveDate,
) -> anyhow::Result<Uuid> {
    tx_at_kind(pool, account_id, account_ext, ext, "transfer", amount, day).await
}

async fn tx_at_kind(
    pool: &PgPool,
    account_id: Uuid,
    account_ext: &str,
    ext: &str,
    kind: &str,
    amount: Decimal,
    day: NaiveDate,
) -> anyhow::Result<Uuid> {
    let mut conn = pool.acquire().await?;
    let mut t = txn(account_ext, ext, kind, amount).described("VIREMENT");
    t.spent_on = day;
    upsert_transaction(&mut conn, account_id, &t).await?;
    let id: Uuid = sqlx::query_scalar("select id from transaction where external_id = $1")
        .bind(ext)
        .fetch_one(pool)
        .await?;
    Ok(id)
}

async fn two_accounts(pool: &PgPool, currency_b: &str) -> anyhow::Result<(Uuid, Uuid, Uuid)> {
    let (user_id, conn_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await?;
    let a = upsert_account(&mut conn, conn_id, &account("acct-a", "EUR")).await?;
    let b = upsert_account(&mut conn, conn_id, &account("acct-b", currency_b)).await?;
    Ok((user_id, a, b))
}

#[gripsou_core::testkit::db_test]
async fn pairs_a_clean_transfer(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let inn = tx_at(&pool, b, "acct-b", "i1", Decimal::new(50000, 2), now).await?;

    assert_eq!(pair(&pool, user_id).await?, 1);

    let system = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.system_key.as_deref() == Some("internal_transfer"))
        .unwrap()
        .id;
    let rows: Vec<PairedRow> = sqlx::query_as(
        "select id, transfer_pair_id, budget_category_id, category_source from transaction order by amount",
    )
    .fetch_all(&pool)
    .await?;
    let outgoing = rows.iter().find(|r| r.0 == out).unwrap();
    let incoming = rows.iter().find(|r| r.0 == inn).unwrap();
    assert_eq!(outgoing.1, Some(inn));
    assert_eq!(incoming.1, Some(out));
    assert_eq!(outgoing.2, Some(system));
    assert_eq!(outgoing.3.as_deref(), Some("pair"));

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_tie_pairs_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::days(2),
    )
    .await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i2",
        Decimal::new(50000, 2),
        now - Duration::days(2),
    )
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    let paired: i64 =
        sqlx::query_scalar("select count(*) from transaction where transfer_pair_id is not null")
            .fetch_one(&pool)
            .await?;
    assert_eq!(paired, 0);
    Ok(())
}

/// Identical transfers tie, but either pairing gives the same result, so they pair one-to-one.
#[gripsou_core::testkit::db_test]
async fn identical_duplicates_pair_one_to_one(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let later = now;
    let o1 = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-500, 2), now).await?;
    let o2 = tx_at(&pool, a, "acct-a", "o2", Decimal::new(-500, 2), now).await?;
    let i1 = tx_at(&pool, b, "acct-b", "i1", Decimal::new(500, 2), later).await?;
    let i2 = tx_at(&pool, b, "acct-b", "i2", Decimal::new(500, 2), later).await?;

    assert_eq!(pair(&pool, user_id).await?, 2);

    let pair_of = |id: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, Option<Uuid>>(
                "select transfer_pair_id from transaction where id = $1",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
        }
    };
    let (p1, p2) = (pair_of(o1).await?, pair_of(o2).await?);
    let mut got = vec![p1.expect("o1 paired"), p2.expect("o2 paired")];
    got.sort();
    let mut want = vec![i1, i2];
    want.sort();
    assert_eq!(got, want, "each out pairs with a different in");
    Ok(())
}

/// A lone -10 transfer is not the counterpart of two identical +10 top-ups.
#[gripsou_core::testkit::db_test]
async fn a_single_row_does_not_claim_one_of_two_duplicates(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    tx_at(
        &pool,
        a,
        "acct-a",
        "o1",
        Decimal::new(-1000, 2),
        now - Duration::days(2),
    )
    .await?;
    tx_at(&pool, b, "acct-b", "i1", Decimal::new(1000, 2), now).await?;
    tx_at(&pool, b, "acct-b", "i2", Decimal::new(1000, 2), now).await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn card_payments_and_deposits_never_pair(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let later = now;
    tx_at_kind(
        &pool,
        a,
        "acct-a",
        "o1",
        "withdrawal",
        Decimal::new(-1000, 2),
        now,
    )
    .await?;
    tx_at(&pool, b, "acct-b", "i1", Decimal::new(1000, 2), later).await?;
    tx_at(&pool, a, "acct-a", "o2", Decimal::new(-2000, 2), now).await?;
    tx_at_kind(
        &pool,
        b,
        "acct-b",
        "i2",
        "deposit",
        Decimal::new(2000, 2),
        later,
    )
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

/// All four rows share two accounts, so any pairing gives the same result.
#[gripsou_core::testkit::db_test]
async fn two_out_on_different_days_pair_with_two_identical_in(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    tx_at(
        &pool,
        a,
        "acct-a",
        "o1",
        Decimal::new(-5000, 2),
        now - Duration::days(1),
    )
    .await?;
    tx_at(&pool, a, "acct-a", "o2", Decimal::new(-5000, 2), now).await?;
    tx_at(&pool, b, "acct-b", "i1", Decimal::new(5000, 2), now).await?;
    tx_at(&pool, b, "acct-b", "i2", Decimal::new(5000, 2), now).await?;

    assert_eq!(pair(&pool, user_id).await?, 2);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_tie_across_different_accounts_still_pairs_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let conn_id: Uuid = sqlx::query_scalar("select connection_id from account where id = $1")
        .bind(a)
        .fetch_one(&pool)
        .await?;
    let c = {
        let mut conn = pool.acquire().await?;
        upsert_account(&mut conn, conn_id, &account("acct-c", "EUR")).await?
    };
    let now = Utc::now().date_naive();
    let later = now;
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-500, 2), now).await?;
    tx_at(&pool, b, "acct-b", "i1", Decimal::new(500, 2), later).await?;
    tx_at(&pool, c, "acct-c", "i2", Decimal::new(500, 2), later).await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_counterpart_outside_the_window_does_not_pair(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::days(6),
    )
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_counterpart_five_days_away_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::days(5),
    )
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 1);
    Ok(())
}

/// Known limit: amounts are not comparable across currencies.
#[gripsou_core::testkit::db_test]
async fn cross_currency_never_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "USD").await?;
    let now = Utc::now().date_naive();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(&pool, b, "acct-b", "i1", Decimal::new(50000, 2), now).await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn two_rows_in_the_same_account_never_pair(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, _b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(&pool, a, "acct-a", "i1", Decimal::new(50000, 2), now).await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_buy_row_never_pairs_even_when_equal_and_opposite(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let buy = tx_at_kind(
        &pool,
        a,
        "acct-a",
        "buy1",
        "buy",
        Decimal::new(-50000, 2),
        now,
    )
    .await?;
    tx_at(&pool, b, "acct-b", "i1", Decimal::new(50000, 2), now).await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    let still: Option<Uuid> =
        sqlx::query_scalar("select transfer_pair_id from transaction where id = $1")
            .bind(buy)
            .fetch_one(&pool)
            .await?;
    assert_eq!(still, None, "a buy row must never be paired");
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn an_ai_categorised_row_still_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let inn = tx_at(&pool, b, "acct-b", "i1", Decimal::new(50000, 2), now).await?;
    let groceries = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;
    sqlx::query(
        "update transaction set budget_category_id = $1, category_source = 'ai', \
         category_confidence = 0.27 where id = $2",
    )
    .bind(groceries)
    .bind(out)
    .execute(&pool)
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 1);

    let confidence: Option<Decimal> =
        sqlx::query_scalar("select category_confidence from transaction where id = $1")
            .bind(out)
            .fetch_one(&pool)
            .await?;
    assert_eq!(confidence, None);

    let system = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.system_key.as_deref() == Some("internal_transfer"))
        .unwrap()
        .id;
    let row: PairedRow = sqlx::query_as(
        "select id, transfer_pair_id, budget_category_id, category_source from transaction where id = $1",
    )
    .bind(out)
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.1, Some(inn), "pairing overwrote the AI guess");
    assert_eq!(row.2, Some(system));
    assert_eq!(row.3.as_deref(), Some("pair"));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_user_categorised_row_is_left_alone(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(&pool, b, "acct-b", "i1", Decimal::new(50000, 2), now).await?;
    let groceries = by_key(&pool, user_id, "groceries").await?;
    file_as(&pool, out, groceries, "user").await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    let still: Option<String> =
        sqlx::query_scalar("select category_source from transaction where id = $1")
            .bind(out)
            .fetch_one(&pool)
            .await?;
    assert_eq!(still.as_deref(), Some("user"));
    Ok(())
}

async fn by_key(pool: &PgPool, user_id: Uuid, key: &str) -> anyhow::Result<Uuid> {
    Ok(list_categories(pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some(key))
        .unwrap()
        .id)
}

async fn file_as(pool: &PgPool, id: Uuid, category: Uuid, source: &str) -> anyhow::Result<()> {
    sqlx::query(
        "update transaction set budget_category_id = $1, category_source = $2 where id = $3",
    )
    .bind(category)
    .bind(source)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_row_the_user_filed_as_neutral_pairs_and_keeps_its_category(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let inn = tx_at(&pool, b, "acct-b", "i1", Decimal::new(50000, 2), now).await?;
    let savings = by_key(&pool, user_id, "savings").await?;
    file_as(&pool, out, savings, "user").await?;

    assert_eq!(pair(&pool, user_id).await?, 1);

    assert_eq!(
        row(&pool, out).await?,
        (out, Some(inn), Some(savings), Some("user".to_string()))
    );
    let system = by_key(&pool, user_id, "internal").await?;
    assert_eq!(
        row(&pool, inn).await?,
        (inn, Some(out), Some(system), Some("pair".to_string()))
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_deposit_filed_as_internal_transfer_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-4000, 2), now).await?;
    let inn = tx_at_kind(
        &pool,
        b,
        "acct-b",
        "i1",
        "deposit",
        Decimal::new(4000, 2),
        now + Duration::days(3),
    )
    .await?;
    let internal = by_key(&pool, user_id, "internal").await?;
    file_as(&pool, inn, internal, "user").await?;

    assert_eq!(pair(&pool, user_id).await?, 1);
    assert_eq!(row(&pool, out).await?.1, Some(inn));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_buy_filed_as_neutral_still_never_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let buy = tx_at_kind(&pool, a, "acct-a", "b1", "buy", Decimal::new(-2100, 2), now).await?;
    let sell = tx_at_kind(&pool, b, "acct-b", "s1", "sell", Decimal::new(2100, 2), now).await?;
    let investments = by_key(&pool, user_id, "investments").await?;
    file_as(&pool, buy, investments, "user").await?;
    file_as(&pool, sell, investments, "user").await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn an_accepted_ai_guess_is_left_alone(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-25000, 2), now).await?;
    let inn = tx_at(&pool, b, "acct-b", "i1", Decimal::new(25000, 2), now).await?;
    let gifts = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("gifts"))
        .unwrap()
        .id;
    sqlx::query(
        "update transaction set budget_category_id = $1, category_source = 'ai', \
         category_confidence = 0.27, category_reviewed_at = now() where id = $2",
    )
    .bind(gifts)
    .bind(out)
    .execute(&pool)
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 0);

    let accepted = row(&pool, out).await?;
    assert_eq!(accepted.1, None, "an accepted guess is never paired");
    assert_eq!(accepted.2, Some(gifts));
    assert_eq!(accepted.3.as_deref(), Some("ai"));
    assert_eq!(row(&pool, inn).await?.1, None);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_row_whose_partner_is_deleted_is_handed_back(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let (b, day): (Uuid, NaiveDate) =
        sqlx::query_as("select account_id, spent_on from transaction where id = $1")
            .bind(inn)
            .fetch_one(&pool)
            .await?;

    sqlx::query("delete from transaction where id = $1")
        .bind(inn)
        .execute(&pool)
        .await?;

    let survivor = row(&pool, out).await?;
    assert_eq!(survivor.1, None);
    assert_eq!(
        survivor.2, None,
        "no internal-transfer category left behind"
    );
    assert_eq!(survivor.3, None);

    let fresh = tx_at(&pool, b, "acct-b", "i2", Decimal::new(50000, 2), day).await?;

    assert_eq!(pair(&pool, user_id).await?, 1);
    assert_eq!(row(&pool, out).await?.1, Some(fresh));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn an_orphaned_half_can_pair_again(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;
    set_category(&pool, user_id, out, Some(groceries)).await;

    let (a, day): (Uuid, NaiveDate) =
        sqlx::query_as("select account_id, spent_on from transaction where id = $1")
            .bind(out)
            .fetch_one(&pool)
            .await?;
    let fresh = tx_at(&pool, a, "acct-a", "o2", Decimal::new(-50000, 2), day).await?;

    assert_eq!(pair(&pool, user_id).await?, 1);
    assert_eq!(row(&pool, inn).await?.1, Some(fresh));
    let corrected = row(&pool, out).await?;
    assert_eq!(corrected.1, None, "the user's correction stands");
    assert_eq!(corrected.3.as_deref(), Some("user"));
    Ok(())
}

/// Round 1 pairs only W-Y (Y's nearest is W). With them gone, X and Z pair in round 2.
#[gripsou_core::testkit::db_test]
async fn a_pair_blocked_in_round_one_forms_in_round_two(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let a = upsert_account(&mut conn, conn_id, &account("acct-a", "EUR")).await?;
    let b = upsert_account(&mut conn, conn_id, &account("acct-b", "EUR")).await?;
    let c = upsert_account(&mut conn, conn_id, &account("acct-c", "EUR")).await?;
    let d = upsert_account(&mut conn, conn_id, &account("acct-d", "EUR")).await?;

    let now = Utc::now().date_naive();
    let x = tx_at(&pool, a, "acct-a", "x", Decimal::new(-50000, 2), now).await?;
    let y = tx_at(
        &pool,
        b,
        "acct-b",
        "y",
        Decimal::new(50000, 2),
        now + Duration::days(3),
    )
    .await?;
    let w = tx_at(
        &pool,
        c,
        "acct-c",
        "w",
        Decimal::new(-50000, 2),
        now + Duration::days(2),
    )
    .await?;
    let z = tx_at(
        &pool,
        d,
        "acct-d",
        "z",
        Decimal::new(50000, 2),
        now + Duration::days(5),
    )
    .await?;

    assert_eq!(
        pair(&pool, user_id).await?,
        2,
        "both W-Y (round 1) and X-Z (round 2) should be written"
    );

    let rows: Vec<PairedRow> = sqlx::query_as(
        "select id, transfer_pair_id, budget_category_id, category_source from transaction",
    )
    .fetch_all(&pool)
    .await?;
    let row = |id: Uuid| rows.iter().find(|r| r.0 == id).unwrap().clone();

    assert_eq!(row(w).1, Some(y));
    assert_eq!(row(y).1, Some(w));
    assert_eq!(
        row(x).1,
        Some(z),
        "X's round-2 match, once Y was no longer available"
    );
    assert_eq!(row(z).1, Some(x));

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

/// X's nearest is Y but Y's is W, so X-Y is not mutual. Fails if the mutual check in `pair_one_round` goes.
#[gripsou_core::testkit::db_test]
async fn nearest_must_be_mutual_or_neither_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let a = upsert_account(&mut conn, conn_id, &account("acct-a", "EUR")).await?;
    let b = upsert_account(&mut conn, conn_id, &account("acct-b", "EUR")).await?;
    let c = upsert_account(&mut conn, conn_id, &account("acct-c", "EUR")).await?;

    let now = Utc::now().date_naive();
    let x = tx_at(&pool, a, "acct-a", "x", Decimal::new(-50000, 2), now).await?;
    let y = tx_at(
        &pool,
        b,
        "acct-b",
        "y",
        Decimal::new(50000, 2),
        now + Duration::days(3),
    )
    .await?;
    let w = tx_at(
        &pool,
        c,
        "acct-c",
        "w",
        Decimal::new(-50000, 2),
        now + Duration::days(2),
    )
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 1);

    let rows: Vec<PairedRow> = sqlx::query_as(
        "select id, transfer_pair_id, budget_category_id, category_source from transaction",
    )
    .fetch_all(&pool)
    .await?;
    let row = |id: Uuid| rows.iter().find(|r| r.0 == id).unwrap().clone();

    assert_eq!(row(w).1, Some(y), "W and Y are each other's mutual nearest");
    assert_eq!(row(y).1, Some(w));
    assert_eq!(
        row(x).1,
        None,
        "X's nearest (Y) did not choose X back, so X stays unpaired"
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn pairs_the_nearest_in_time_not_the_farthest(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let near = tx_at(
        &pool,
        b,
        "acct-b",
        "near",
        Decimal::new(50000, 2),
        now + Duration::days(1),
    )
    .await?;
    let far = tx_at(
        &pool,
        b,
        "acct-b",
        "far",
        Decimal::new(50000, 2),
        now + Duration::days(5),
    )
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 1);

    let paired_with: Option<Uuid> =
        sqlx::query_scalar("select transfer_pair_id from transaction where id = $1")
            .bind(out)
            .fetch_one(&pool)
            .await?;
    assert_eq!(paired_with, Some(near));
    let far_pair: Option<Uuid> =
        sqlx::query_scalar("select transfer_pair_id from transaction where id = $1")
            .bind(far)
            .fetch_one(&pool)
            .await?;
    assert_eq!(far_pair, None);
    Ok(())
}

/// Seeds a savings, deposit, current account chain of `amount` at `day`.
/// Returns (livret out, depot in, depot out, courant in).
async fn chain_at(
    pool: &PgPool,
    [livret, depot, courant]: [Uuid; 3],
    tag: &str,
    amount: Decimal,
    day: NaiveDate,
) -> anyhow::Result<[Uuid; 4]> {
    Ok([
        tx_at(pool, livret, "livret", &format!("{tag}-lo"), -amount, day).await?,
        tx_at(pool, depot, "depot", &format!("{tag}-di"), amount, day).await?,
        tx_at(pool, depot, "depot", &format!("{tag}-do"), -amount, day).await?,
        tx_at(pool, courant, "courant", &format!("{tag}-ci"), amount, day).await?,
    ])
}

async fn chain_accounts(pool: &PgPool) -> anyhow::Result<(Uuid, [Uuid; 3])> {
    let (user_id, conn_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await?;
    let mut ids = [Uuid::nil(); 3];
    for (slot, ext) in ids.iter_mut().zip(["livret", "depot", "courant"]) {
        *slot = upsert_account(&mut conn, conn_id, &account(ext, "EUR")).await?;
    }
    Ok((user_id, ids))
}

async fn partner(pool: &PgPool, id: Uuid) -> anyhow::Result<Option<Uuid>> {
    Ok(
        sqlx::query_scalar("select transfer_pair_id from transaction where id = $1")
            .bind(id)
            .fetch_one(pool)
            .await?,
    )
}

/// All rows of a same-day chain tie, but the depot can't pay itself, so only one explanation fits.
#[gripsou_core::testkit::db_test]
async fn a_chain_through_a_middle_account_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, accts) = chain_accounts(&pool).await?;
    let [lo, di, dout, ci] = chain_at(
        &pool,
        accts,
        "c",
        Decimal::new(10000, 2),
        Utc::now().date_naive(),
    )
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 2);
    assert_eq!(partner(&pool, lo).await?, Some(di));
    assert_eq!(partner(&pool, dout).await?, Some(ci));
    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

/// An extra same-amount inflow means some row is not an own-account move, and nothing says which.
#[gripsou_core::testkit::db_test]
async fn a_chain_with_a_stray_row_pairs_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, accts) = chain_accounts(&pool).await?;
    let now = Utc::now().date_naive();
    chain_at(&pool, accts, "c", Decimal::new(10000, 2), now).await?;
    let mut conn = pool.acquire().await?;
    let (_, conn_id): (Uuid, Uuid) =
        sqlx::query_as("select k.user_id, k.id from connection k where k.user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await?;
    let other = upsert_account(&mut conn, conn_id, &account("other", "EUR")).await?;
    tx_at(&pool, other, "other", "stray", Decimal::new(10000, 2), now).await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn two_identical_chains_the_same_day_pair(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, accts) = chain_accounts(&pool).await?;
    let now = Utc::now().date_naive();
    chain_at(&pool, accts, "c1", Decimal::new(10000, 2), now).await?;
    chain_at(&pool, accts, "c2", Decimal::new(10000, 2), now).await?;

    assert_eq!(pair(&pool, user_id).await?, 4);
    Ok(())
}

/// Chains two days apart share one 3-day window, so each day is resolved on its own.
#[gripsou_core::testkit::db_test]
async fn chains_on_nearby_days_pair_within_their_own_day(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, accts) = chain_accounts(&pool).await?;
    let now = Utc::now().date_naive();
    let [lo1, di1, do1, ci1] = chain_at(&pool, accts, "c1", Decimal::new(10000, 2), now).await?;
    let [lo2, di2, do2, ci2] = chain_at(
        &pool,
        accts,
        "c2",
        Decimal::new(10000, 2),
        now + Duration::days(2),
    )
    .await?;

    assert_eq!(pair(&pool, user_id).await?, 4);
    assert_eq!(partner(&pool, lo1).await?, Some(di1));
    assert_eq!(partner(&pool, do1).await?, Some(ci1));
    assert_eq!(partner(&pool, lo2).await?, Some(di2));
    assert_eq!(partner(&pool, do2).await?, Some(ci2));
    Ok(())
}

async fn seeded_pair(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid, Uuid)> {
    let (user_id, a, b) = two_accounts(pool, "EUR").await?;
    let now = Utc::now().date_naive();
    let out = tx_at(pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let inn = tx_at(pool, b, "acct-b", "i1", Decimal::new(50000, 2), now).await?;
    assert_eq!(pair(pool, user_id).await?, 1);
    Ok((user_id, out, inn))
}

async fn a_category(pool: &PgPool, user_id: Uuid) -> anyhow::Result<Uuid> {
    Ok(list_categories(pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.system_key.is_none() && c.kind == CategoryKind::Expense)
        .expect("the seed ships at least one non-system expense category")
        .id)
}

async fn row(pool: &PgPool, id: Uuid) -> anyhow::Result<PairedRow> {
    Ok(sqlx::query_as(
        "select id, transfer_pair_id, budget_category_id, category_source from transaction where id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await?)
}

async fn tie_the_pair(pool: &PgPool, out: Uuid, inn: Uuid) -> anyhow::Result<()> {
    let (out_ts,): (NaiveDate,) = sqlx::query_as("select spent_on from transaction where id = $1")
        .bind(out)
        .fetch_one(pool)
        .await?;
    let (b, in_ts): (Uuid, NaiveDate) =
        sqlx::query_as("select account_id, spent_on from transaction where id = $1")
            .bind(inn)
            .fetch_one(pool)
            .await?;
    tx_at(
        pool,
        b,
        "acct-b",
        "i2",
        Decimal::new(50000, 2),
        out_ts - (in_ts - out_ts),
    )
    .await?;
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_pair_that_no_longer_holds_is_undone(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    tie_the_pair(&pool, out, inn).await?;

    assert_eq!(pair(&pool, user_id).await?, 0);
    assert_eq!(row(&pool, out).await?, (out, None, None, None));
    assert_eq!(row(&pool, inn).await?, (inn, None, None, None));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn undoing_a_pair_keeps_a_category_the_user_chose(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let savings = by_key(&pool, user_id, "savings").await?;
    set_category(&pool, user_id, out, Some(savings)).await;
    assert_eq!(
        row(&pool, out).await?.1,
        Some(inn),
        "a neutral write keeps the pair"
    );
    tie_the_pair(&pool, out, inn).await?;

    pair(&pool, user_id).await?;
    assert_eq!(
        row(&pool, out).await?,
        (out, None, Some(savings), Some("user".to_string()))
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn filing_the_row_that_blocked_a_pair_lets_it_form(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    tie_the_pair(&pool, out, inn).await?;
    pair(&pool, user_id).await?;
    assert_eq!(row(&pool, out).await?.1, None);

    let stray: Uuid = sqlx::query_scalar("select id from transaction where external_id = 'i2'")
        .fetch_one(&pool)
        .await?;
    let groceries = a_category(&pool, user_id).await?;
    set_category(&pool, user_id, stray, Some(groceries)).await;

    assert_eq!(pair(&pool, user_id).await?, 1);
    assert_eq!(row(&pool, out).await?.1, Some(inn));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn categorising_one_half_unlinks_both(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;

    set_category(&pool, user_id, out, Some(groceries)).await;

    let touched = row(&pool, out).await?;
    assert_eq!(touched.1, None, "the touched half keeps no pair link");
    assert_eq!(touched.2, Some(groceries));
    assert_eq!(touched.3.as_deref(), Some("user"));

    let other = row(&pool, inn).await?;
    assert_eq!(
        other.1, None,
        "the other half must not be left pointing at a row that is no longer a transfer"
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn the_other_half_keeps_its_category(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let before = row(&pool, inn).await?;
    let groceries = a_category(&pool, user_id).await?;

    set_category(&pool, user_id, out, Some(groceries)).await;

    let after = row(&pool, inn).await?;
    assert_eq!(after.2, before.2, "category untouched");
    assert_eq!(after.3, before.3, "category_source untouched");
    assert_eq!(after.3.as_deref(), Some("pair"));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn clearing_the_category_also_unlinks_both(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;

    set_category(&pool, user_id, out, None).await;

    assert_eq!(row(&pool, out).await?.1, None);
    assert_eq!(row(&pool, inn).await?.1, None);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_foreign_transaction_dissolves_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (_user_id, out, inn) = seeded_pair(&pool).await?;
    let (stranger, _c) = seed_user_and_connection(&pool).await;

    let outcome = patch_transaction(
        &pool,
        stranger,
        out,
        &TransactionPatch {
            category_id: Some(None),
            ..TransactionPatch::default()
        },
        true,
    )
    .await?;
    assert_eq!(outcome, WriteOutcome::Refused(Refusal::NotFound));

    assert_eq!(row(&pool, out).await?.1, Some(inn));
    assert_eq!(row(&pool, inn).await?.1, Some(out));
    Ok(())
}

/// Both halves in one bulk write: neither may be left half-linked.
#[gripsou_core::testkit::db_test]
async fn a_bulk_write_covering_both_halves_unlinks_cleanly(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;

    assert_eq!(
        bulk_apply(&pool, user_id, &[out, inn], category(groceries), true).await?,
        WriteOutcome::Done(2)
    );

    assert_eq!(row(&pool, out).await?.1, None);
    assert_eq!(row(&pool, inn).await?.1, None);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn applying_to_a_description_unlinks_the_pairs_it_touches(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;

    // Same description on both halves, so the sweep takes the counterpart too.
    let outcome = apply_to_description(
        &pool,
        user_id,
        out,
        Some(groceries),
        SameDescription::All,
        true,
    )
    .await?;
    assert!(matches!(outcome, WriteOutcome::Done(ids) if ids.len() == 2));

    assert_eq!(row(&pool, out).await?.1, None);
    assert_eq!(row(&pool, inn).await?.1, None);
    Ok(())
}

fn category(id: Uuid) -> BulkChanges<'static> {
    BulkChanges {
        category_id: Some(Some(id)),
        ..BulkChanges::default()
    }
}

#[gripsou_core::testkit::db_test]
async fn counts_the_pairs_a_write_would_break(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;

    assert_eq!(
        bulk_apply(&pool, user_id, &[out], category(groceries), false).await?,
        WriteOutcome::PendingPairBreaks(1)
    );
    assert_eq!(
        bulk_apply(&pool, user_id, &[out, inn], category(groceries), false).await?,
        WriteOutcome::PendingPairBreaks(2),
        "both halves count: the modal reports rows affected, not pairs"
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn another_users_pairs_are_not_counted(pool: PgPool) -> anyhow::Result<()> {
    let (_user_id, out, _inn) = seeded_pair(&pool).await?;
    let (stranger, _c) = seed_user_and_connection(&pool).await;
    let theirs = a_category(&pool, stranger).await?;

    assert_eq!(
        bulk_apply(&pool, stranger, &[out], category(theirs), false).await?,
        WriteOutcome::Done(0)
    );
    Ok(())
}

async fn pair(pool: &PgPool, user_id: Uuid) -> anyhow::Result<usize> {
    let mut tx = gripsou_core::db::begin_user_writes(pool, user_id).await?;
    let paired = pair_internal_transfers(&mut tx).await?;
    tx.commit().await?;
    Ok(paired)
}
