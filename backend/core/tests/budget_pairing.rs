mod common;

use chrono::{DateTime, Duration, Utc};
use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::budget::pairing::pair_internal_transfers;
use gripsou_core::dto::CanonicalAccount;
use gripsou_core::error::CoreError;
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::assign::{
    apply_category_to_same_description, bulk_set_category, count_paired, set_category,
};
use gripsou_core::repo::budget::category::list_categories;
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

/// Row shape shared by the "assert every column" checks below.
type PairedRow = (Uuid, Option<Uuid>, Option<Uuid>, Option<String>);

fn account(external_id: &str, currency: &str) -> CanonicalAccount {
    CanonicalAccount {
        currency: currency.to_string(),
        ..checking_account(external_id)
    }
}

/// Inserts a `transfer` at an explicit instant — the only type pairing
/// considers.
async fn tx_at(
    pool: &PgPool,
    account_id: Uuid,
    account_ext: &str,
    ext: &str,
    amount: Decimal,
    ts: DateTime<Utc>,
) -> anyhow::Result<Uuid> {
    tx_at_kind(pool, account_id, account_ext, ext, "transfer", amount, ts).await
}

/// Same as [`tx_at`], but with an explicit transaction `type` rather than the
/// transfer default — needed to seed a `buy`, `sell`, `dividend`,
/// `fee` or `interest` row.
async fn tx_at_kind(
    pool: &PgPool,
    account_id: Uuid,
    account_ext: &str,
    ext: &str,
    kind: &str,
    amount: Decimal,
    ts: DateTime<Utc>,
) -> anyhow::Result<Uuid> {
    let mut conn = pool.acquire().await?;
    let mut t = txn(account_ext, ext, kind, amount, Some("VIREMENT"));
    t.ts = ts;
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

#[sqlx::test(migrations = "../migrations")]
async fn pairs_a_clean_transfer(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let inn = tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(4),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);

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

    // Running again changes nothing.
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

/// Two equally-near candidates: pair neither. A wrong pair silently deletes
/// real spending from every chart; an unpaired row costs one correction.
#[sqlx::test(migrations = "../migrations")]
async fn a_tie_pairs_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(2),
    )
    .await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i2",
        Decimal::new(50000, 2),
        now - Duration::hours(2),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    let paired: i64 =
        sqlx::query_scalar("select count(*) from transaction where transfer_pair_id is not null")
            .fetch_one(&pool)
            .await?;
    assert_eq!(paired, 0);
    Ok(())
}

/// Two identical transfers sent together (same accounts, amount and instant on
/// each side) tie with each other, but the tie is harmless: whichever way they
/// pair, the result is the same. So they pair one-to-one instead of not at all.
#[sqlx::test(migrations = "../migrations")]
async fn identical_duplicates_pair_one_to_one(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let later = now + Duration::hours(1);
    let o1 = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-500, 2), now).await?;
    let o2 = tx_at(&pool, a, "acct-a", "o2", Decimal::new(-500, 2), now).await?;
    let i1 = tx_at(&pool, b, "acct-b", "i1", Decimal::new(500, 2), later).await?;
    let i2 = tx_at(&pool, b, "acct-b", "i2", Decimal::new(500, 2), later).await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 2);

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

/// Resolving a duplicate tie must not let an unrelated single row claim one of
/// the duplicates: a lone -10 transfer to a friend two days before two
/// identical +10 top-ups is not their counterpart. Only a group of k identical rows pairs
/// with a group of k identical rows.
#[sqlx::test(migrations = "../migrations")]
async fn a_single_row_does_not_claim_one_of_two_duplicates(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
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

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

/// Only transfers pair. A card payment or cash withdrawal equal to a transfer
/// arriving elsewhere is money leaving the user (a shop, an ATM), and a
/// deposit equal to a transfer leaving is money arriving from someone else
/// ("From Camille R") — neither is a movement between the user's accounts.
#[sqlx::test(migrations = "../migrations")]
async fn card_payments_and_deposits_never_pair(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let later = now + Duration::hours(1);
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

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

/// Two transfers out on different days and two identical transfers in: all
/// four are between the same two accounts, so whichever pairs with which the
/// result is the same, and both pairs form.
#[sqlx::test(migrations = "../migrations")]
async fn two_out_on_different_days_pair_with_two_identical_in(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
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

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 2);
    Ok(())
}

/// Same amount and instant is not enough: counterparts on two different
/// accounts are a real ambiguity, so the tie still pairs nothing.
#[sqlx::test(migrations = "../migrations")]
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
    let now = Utc::now();
    let later = now + Duration::hours(1);
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-500, 2), now).await?;
    tx_at(&pool, b, "acct-b", "i1", Decimal::new(500, 2), later).await?;
    tx_at(&pool, c, "acct-c", "i2", Decimal::new(500, 2), later).await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_counterpart_outside_the_window_does_not_pair(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::days(5) + Duration::hours(1),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

/// The window's edge is inclusive: five days apart still pairs.
#[sqlx::test(migrations = "../migrations")]
async fn a_counterpart_five_days_away_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
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

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);
    Ok(())
}

/// Equal |amount| is meaningless across currencies, so a cross-currency
/// transfer never auto-pairs. Known limit, stated rather than papered over.
#[sqlx::test(migrations = "../migrations")]
async fn cross_currency_never_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "USD").await?;
    let now = Utc::now();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(1),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn two_rows_in_the_same_account_never_pair(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, _b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(
        &pool,
        a,
        "acct-a",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(1),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

/// A `buy` row that is equal and opposite to a `deposit` within the window
/// must never be filed as an internal transfer: it is a coincidence of
/// amount, not a movement between the user's own accounts, and a PEA `buy`
/// hidden this way would be uncorrectable through the transactions list. This
/// would fail (pairing the two) if the candidate query's `t.type in
/// ('deposit', 'withdrawal', 'transfer')` filter were reverted.
#[sqlx::test(migrations = "../migrations")]
async fn a_buy_row_never_pairs_even_when_equal_and_opposite(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
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
    tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(1),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    let still: Option<Uuid> =
        sqlx::query_scalar("select transfer_pair_id from transaction where id = $1")
            .bind(buy)
            .fetch_one(&pool)
            .await?;
    assert_eq!(still, None, "a buy row must never be paired");
    Ok(())
}

/// Pairing is allowed to overwrite an AI guess nobody has reviewed, since
/// pairing outranks it, but never a category the user chose. This would fail
/// (leaving the AI row unpaired) if the candidate filter reverted to
/// `category_source is null` only.
#[sqlx::test(migrations = "../migrations")]
async fn an_ai_categorised_row_still_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let inn = tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(1),
    )
    .await?;
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

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);

    // The guess is gone, so is its confidence: a pair row carries none.
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

/// Precedence: a row the user filed as something that counts — an expense
/// here — is never touched by the pass.
#[sqlx::test(migrations = "../migrations")]
async fn a_user_categorised_row_is_left_alone(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(1),
    )
    .await?;
    let groceries = by_key(&pool, user_id, "groceries").await?;
    file_as(&pool, out, groceries, "user").await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
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

/// A row the user filed in a neutral category already counts toward nothing,
/// so pairing it hides nothing: it pairs, and keeps the category they chose.
/// The other half, which nobody filed, becomes a pairing-set transfer.
#[sqlx::test(migrations = "../migrations")]
async fn a_row_the_user_filed_as_neutral_pairs_and_keeps_its_category(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let inn = tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(1),
    )
    .await?;
    let savings = by_key(&pool, user_id, "savings").await?;
    file_as(&pool, out, savings, "user").await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);

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

/// A real transfer the provider labels a deposit (or a card payment) pairs
/// once it is filed in a neutral category; unfiled, it never does — see
/// `card_payments_and_deposits_never_pair`.
#[sqlx::test(migrations = "../migrations")]
async fn a_deposit_filed_as_internal_transfer_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
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

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);
    assert_eq!(row(&pool, out).await?.1, Some(inn));
    Ok(())
}

/// A row filed as neutral whose other half is on no connected account (a top-up
/// of an outside wallet) must not block a transfer pairing would have made
/// without it. In one pool, its account would hold two equal rows leaving
/// against one arriving, and the tie would pair nothing; the filed rows only
/// join once the undecided transfers have paired.
#[sqlx::test(migrations = "../migrations")]
async fn a_filed_row_never_blocks_a_transfer_that_pairs_without_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-1000, 2), now).await?;
    let inn = tx_at(&pool, b, "acct-b", "i1", Decimal::new(1000, 2), now).await?;
    let wallet = tx_at_kind(
        &pool,
        a,
        "acct-a",
        "w1",
        "withdrawal",
        Decimal::new(-1000, 2),
        now,
    )
    .await?;
    let internal = by_key(&pool, user_id, "internal").await?;
    file_as(&pool, wallet, internal, "user").await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);
    assert_eq!(row(&pool, out).await?.1, Some(inn));
    assert_eq!(row(&pool, wallet).await?.1, None);
    Ok(())
}

/// The cash leg of a buy or sell never pairs, even filed as Investments: the
/// lot is its record, and a broker mirrors it across its cash and portfolio
/// accounts.
#[sqlx::test(migrations = "../migrations")]
async fn a_buy_filed_as_neutral_still_never_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let buy = tx_at_kind(&pool, a, "acct-a", "b1", "buy", Decimal::new(-2100, 2), now).await?;
    let sell = tx_at_kind(&pool, b, "acct-b", "s1", "sell", Decimal::new(2100, 2), now).await?;
    let investments = by_key(&pool, user_id, "investments").await?;
    file_as(&pool, buy, investments, "user").await?;
    file_as(&pool, sell, investments, "user").await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

/// An AI guess the user accepted in review is their choice, not a guess any
/// more: pairing leaves it exactly as accepted, even when a perfect
/// counterpart exists.
#[sqlx::test(migrations = "../migrations")]
async fn an_accepted_ai_guess_is_left_alone(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-25000, 2), now).await?;
    let inn = tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(25000, 2),
        now + Duration::hours(1),
    )
    .await?;
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

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);

    let accepted = row(&pool, out).await?;
    assert_eq!(accepted.1, None, "an accepted guess is never paired");
    assert_eq!(accepted.2, Some(gifts));
    assert_eq!(accepted.3.as_deref(), Some("ai"));
    assert_eq!(row(&pool, inn).await?.1, None);
    Ok(())
}

/// A paired row whose partner is deleted (its connection removed) would
/// otherwise keep the internal-transfer category with nothing to net against,
/// and count as money set aside. It goes back to uncategorised, and the next
/// pass may pair it again.
#[sqlx::test(migrations = "../migrations")]
async fn a_row_whose_partner_is_deleted_is_handed_back(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let (b, ts): (Uuid, DateTime<Utc>) =
        sqlx::query_as("select account_id, ts from transaction where id = $1")
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

    let fresh = tx_at(
        &pool,
        b,
        "acct-b",
        "i2",
        Decimal::new(50000, 2),
        ts + Duration::hours(1),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);
    assert_eq!(row(&pool, out).await?.1, Some(fresh));
    Ok(())
}

/// A pair the user breaks by recategorising one half leaves the other half
/// flagged as an orphaned transfer. It is still a transfer nobody has matched,
/// so a later pass may pair it with a better counterpart.
#[sqlx::test(migrations = "../migrations")]
async fn an_orphaned_half_can_pair_again(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;
    assert!(set_category(&pool, user_id, out, Some(groceries)).await?);

    let (a, ts): (Uuid, DateTime<Utc>) =
        sqlx::query_as("select account_id, ts from transaction where id = $1")
            .bind(out)
            .fetch_one(&pool)
            .await?;
    let fresh = tx_at(
        &pool,
        a,
        "acct-a",
        "o2",
        Decimal::new(-50000, 2),
        ts + Duration::hours(1),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);
    assert_eq!(row(&pool, inn).await?.1, Some(fresh));
    let corrected = row(&pool, out).await?;
    assert_eq!(corrected.1, None, "the user's correction stands");
    assert_eq!(corrected.3.as_deref(), Some("user"));
    Ok(())
}

/// A single round of mutual-nearest-neighbour matching can leave a true pair
/// unwritten because its would-be counterpart is temporarily claimed by
/// someone closer; the next round, with that claim resolved, finds it. This
/// asserts on the total returned by the public function across however many
/// internal rounds it takes — it would fail if `pair_internal_transfers`
/// stopped after one round instead of looping to convergence.
///
/// Round 1: X's nearest is Y, but Y's nearest is W (closer), so only W-Y is
/// mutual and pairs; X and Z are both left over. Round 2, with Y and W gone
/// from the pool, X and Z are now each other's only (and so mutual) option.
#[sqlx::test(migrations = "../migrations")]
async fn a_pair_blocked_in_round_one_forms_in_round_two(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let a = upsert_account(&mut conn, conn_id, &account("acct-a", "EUR")).await?;
    let b = upsert_account(&mut conn, conn_id, &account("acct-b", "EUR")).await?;
    let c = upsert_account(&mut conn, conn_id, &account("acct-c", "EUR")).await?;
    let d = upsert_account(&mut conn, conn_id, &account("acct-d", "EUR")).await?;

    let now = Utc::now();
    let x = tx_at(&pool, a, "acct-a", "x", Decimal::new(-50000, 2), now).await?;
    let y = tx_at(
        &pool,
        b,
        "acct-b",
        "y",
        Decimal::new(50000, 2),
        now + Duration::hours(3),
    )
    .await?;
    let w = tx_at(
        &pool,
        c,
        "acct-c",
        "w",
        Decimal::new(-50000, 2),
        now + Duration::hours(2),
    )
    .await?;
    // Z: farther from X than Y is, so round 1's nearest for X is still Y, not
    // Z — Z only becomes reachable once Y is claimed by W.
    let z = tx_at(
        &pool,
        d,
        "acct-d",
        "z",
        Decimal::new(50000, 2),
        now + Duration::hours(10),
    )
    .await?;

    assert_eq!(
        pair_internal_transfers(&mut conn, user_id).await?,
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

    // Re-running a converged pass writes nothing further.
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

/// A single round of mutual-nearest-neighbour matching does not pair every
/// non-mutual candidate with *something*: X's nearest is Y, but Y's own
/// nearest is W (closer to Y than X is), so X-Y is not mutual. Only W-Y is.
/// This is the case the mutual check at the end of `pair_one_round` exists
/// for — deleting that check (pairing every entry in `out_choice`
/// unconditionally) would pair X here, which this test catches.
#[sqlx::test(migrations = "../migrations")]
async fn nearest_must_be_mutual_or_neither_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let a = upsert_account(&mut conn, conn_id, &account("acct-a", "EUR")).await?;
    let b = upsert_account(&mut conn, conn_id, &account("acct-b", "EUR")).await?;
    let c = upsert_account(&mut conn, conn_id, &account("acct-c", "EUR")).await?;

    let now = Utc::now();
    // X: outflow on account a, 3h from the only inflow Y — X's nearest (its
    // only candidate) is Y.
    let x = tx_at(&pool, a, "acct-a", "x", Decimal::new(-50000, 2), now).await?;
    // Y: the one inflow, on account b.
    let y = tx_at(
        &pool,
        b,
        "acct-b",
        "y",
        Decimal::new(50000, 2),
        now + Duration::hours(3),
    )
    .await?;
    // W: outflow on account c, only 1h from Y — closer than X is, so Y's own
    // nearest is W, not X.
    let w = tx_at(
        &pool,
        c,
        "acct-c",
        "w",
        Decimal::new(-50000, 2),
        now + Duration::hours(2),
    )
    .await?;

    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);

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

/// Among several candidates within the window, the nearest in time wins, not
/// an arbitrary or farthest one. Flipping the `gap < best_gap` comparison to
/// prefer the farther candidate would pick the +5h inflow instead and this
/// test would fail.
#[sqlx::test(migrations = "../migrations")]
async fn pairs_the_nearest_in_time_not_the_farthest(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    let out = tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let near = tx_at(
        &pool,
        b,
        "acct-b",
        "near",
        Decimal::new(50000, 2),
        now + Duration::hours(1),
    )
    .await?;
    let far = tx_at(
        &pool,
        b,
        "acct-b",
        "far",
        Decimal::new(50000, 2),
        now + Duration::hours(5),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);

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

/// A savings account whose transfers to the current account pass through a
/// deposit account (savings → deposit → current account), as seen on
/// real data. Seeds one such chain of `amount` at `ts`, returning its rows as
/// (livret out, depot in, depot out, courant in).
async fn chain_at(
    pool: &PgPool,
    [livret, depot, courant]: [Uuid; 3],
    tag: &str,
    amount: Decimal,
    ts: DateTime<Utc>,
) -> anyhow::Result<[Uuid; 4]> {
    Ok([
        tx_at(pool, livret, "livret", &format!("{tag}-lo"), -amount, ts).await?,
        tx_at(pool, depot, "depot", &format!("{tag}-di"), amount, ts).await?,
        tx_at(pool, depot, "depot", &format!("{tag}-do"), -amount, ts).await?,
        tx_at(pool, courant, "courant", &format!("{tag}-ci"), amount, ts).await?,
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

/// Every row of a same-day chain ties (the Livret outflow is equally near the
/// depot and current-account inflows), so nearest-neighbour matching alone
/// pairs nothing. But the depot can't pay itself, so there is only one way
/// to explain all four rows — and that one is taken.
#[sqlx::test(migrations = "../migrations")]
async fn a_chain_through_a_middle_account_pairs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, accts) = chain_accounts(&pool).await?;
    let [lo, di, dout, ci] =
        chain_at(&pool, accts, "c", Decimal::new(10000, 2), Utc::now()).await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 2);
    assert_eq!(partner(&pool, lo).await?, Some(di));
    assert_eq!(partner(&pool, dout).await?, Some(ci));
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

/// One extra same-amount inflow elsewhere means some row in the cluster is
/// not a movement between the user's accounts, and nothing says which — so
/// nothing pairs.
#[sqlx::test(migrations = "../migrations")]
async fn a_chain_with_a_stray_row_pairs_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, accts) = chain_accounts(&pool).await?;
    let now = Utc::now();
    chain_at(&pool, accts, "c", Decimal::new(10000, 2), now).await?;
    let mut conn = pool.acquire().await?;
    let (_, conn_id): (Uuid, Uuid) =
        sqlx::query_as("select k.user_id, k.id from connection k where k.user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await?;
    let other = upsert_account(&mut conn, conn_id, &account("other", "EUR")).await?;
    tx_at(&pool, other, "other", "stray", Decimal::new(10000, 2), now).await?;

    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    Ok(())
}

/// Two identical chains the same day: which Livret row goes with which depot
/// row makes no difference, so both chains pair.
#[sqlx::test(migrations = "../migrations")]
async fn two_identical_chains_the_same_day_pair(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, accts) = chain_accounts(&pool).await?;
    let now = Utc::now();
    chain_at(&pool, accts, "c1", Decimal::new(10000, 2), now).await?;
    chain_at(&pool, accts, "c2", Decimal::new(10000, 2), now).await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 4);
    Ok(())
}

/// Chains two days apart fall inside one three-day window, where a Livret
/// row could as well go with the other day's depot row. Looking at each day
/// first keeps each chain to itself.
#[sqlx::test(migrations = "../migrations")]
async fn chains_on_nearby_days_pair_within_their_own_day(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, accts) = chain_accounts(&pool).await?;
    let now = Utc::now();
    let [lo1, di1, do1, ci1] = chain_at(&pool, accts, "c1", Decimal::new(10000, 2), now).await?;
    let [lo2, di2, do2, ci2] = chain_at(
        &pool,
        accts,
        "c2",
        Decimal::new(10000, 2),
        now + Duration::days(2),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 4);
    assert_eq!(partner(&pool, lo1).await?, Some(di1));
    assert_eq!(partner(&pool, do1).await?, Some(ci1));
    assert_eq!(partner(&pool, lo2).await?, Some(di2));
    assert_eq!(partner(&pool, do2).await?, Some(ci2));
    Ok(())
}

/// If this user's `internal_transfer` budget_category row is missing (it is
/// trigger-seeded and the repository refuses to delete it, but nothing below
/// the repository layer enforces that), the pairing UPDATE's join to it
/// matches nothing. That must surface as an error, not as a silently
/// unwritten "pair" that the next round would recompute forever. Bypasses
/// the repository (which would refuse) with a direct delete, the same way
/// other tests here reach past it to force a state the app itself would
/// never produce.
#[sqlx::test(migrations = "../migrations")]
async fn missing_internal_transfer_category_is_a_hard_error(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, b) = two_accounts(&pool, "EUR").await?;
    let now = Utc::now();
    tx_at(&pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    tx_at(
        &pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(1),
    )
    .await?;

    sqlx::query(
        "delete from budget_category where user_id = $1 and system_key = 'internal_transfer'",
    )
    .bind(user_id)
    .execute(&pool)
    .await?;

    let mut conn = pool.acquire().await?;
    let err = pair_internal_transfers(&mut conn, user_id)
        .await
        .expect_err("the pairing UPDATE's join to internal_transfer matched nothing");
    assert!(
        matches!(err, CoreError::TransferPairNotWritten { .. }),
        "expected TransferPairNotWritten, got {err:?}"
    );

    // Nothing was left half-written: the candidates are exactly as they were.
    let paired: i64 =
        sqlx::query_scalar("select count(*) from transaction where transfer_pair_id is not null")
            .fetch_one(&pool)
            .await?;
    assert_eq!(paired, 0);
    Ok(())
}

// ---------------------------------------------------------------------------
// Dissolving a pair
//
// A user category outranks pairing, so a user may always overrule the
// pairing heuristic — it is timid, but it can still false-match
// two unrelated movements of the same amount. What must not survive that
// correction is the link itself: a row pointing at a counterpart that is no
// longer a transfer is a half-transfer that nets against nothing.
// ---------------------------------------------------------------------------

/// Seeds a paired transfer and returns `(user_id, outgoing, incoming)`.
async fn seeded_pair(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid, Uuid)> {
    let (user_id, a, b) = two_accounts(pool, "EUR").await?;
    let now = Utc::now();
    let out = tx_at(pool, a, "acct-a", "o1", Decimal::new(-50000, 2), now).await?;
    let inn = tx_at(
        pool,
        b,
        "acct-b",
        "i1",
        Decimal::new(50000, 2),
        now + Duration::hours(4),
    )
    .await?;
    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);
    Ok((user_id, out, inn))
}

async fn a_category(pool: &PgPool, user_id: Uuid) -> anyhow::Result<Uuid> {
    Ok(list_categories(pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.system_key.is_none() && c.kind == "expense")
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

#[sqlx::test(migrations = "../migrations")]
async fn categorising_one_half_unlinks_both(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;

    assert!(set_category(&pool, user_id, out, Some(groceries)).await?);

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

#[sqlx::test(migrations = "../migrations")]
async fn the_other_half_keeps_its_category(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let before = row(&pool, inn).await?;
    let groceries = a_category(&pool, user_id).await?;

    assert!(set_category(&pool, user_id, out, Some(groceries)).await?);

    let after = row(&pool, inn).await?;
    assert_eq!(after.2, before.2, "category untouched");
    assert_eq!(after.3, before.3, "category_source untouched");
    assert_eq!(after.3.as_deref(), Some("pair"));
    Ok(())
}

/// Clearing is a user category write too: the same dissolution applies, so a
/// cleared row never keeps a stale link.
#[sqlx::test(migrations = "../migrations")]
async fn clearing_the_category_also_unlinks_both(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;

    assert!(set_category(&pool, user_id, out, None).await?);

    assert_eq!(row(&pool, out).await?.1, None);
    assert_eq!(row(&pool, inn).await?.1, None);
    Ok(())
}

/// Another user's transaction is not this user's to unlink.
#[sqlx::test(migrations = "../migrations")]
async fn a_foreign_transaction_dissolves_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (_user_id, out, inn) = seeded_pair(&pool).await?;
    let stranger = Uuid::new_v4();

    assert!(!set_category(&pool, stranger, out, None).await?);

    assert_eq!(row(&pool, out).await?.1, Some(inn));
    assert_eq!(row(&pool, inn).await?.1, Some(out));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_bulk_category_write_unlinks_the_pairs_it_touches(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;

    assert_eq!(
        bulk_set_category(&pool, user_id, &[out], Some(groceries)).await?,
        1
    );

    assert_eq!(row(&pool, out).await?.1, None);
    assert_eq!(row(&pool, inn).await?.1, None);
    Ok(())
}

/// Both halves in one bulk write: each dissolves the other, and neither is
/// left half-linked by the order the UPDATE happened to visit them in.
#[sqlx::test(migrations = "../migrations")]
async fn a_bulk_write_covering_both_halves_unlinks_cleanly(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;

    assert_eq!(
        bulk_set_category(&pool, user_id, &[out, inn], Some(groceries)).await?,
        2
    );

    assert_eq!(row(&pool, out).await?.1, None);
    assert_eq!(row(&pool, inn).await?.1, None);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn applying_to_a_description_unlinks_the_pairs_it_touches(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;
    let groceries = a_category(&pool, user_id).await?;

    // Both halves are seeded with the same description ("VIREMENT"), so this
    // sweeps up the counterpart as well as the row it was launched from.
    assert!(
        !apply_category_to_same_description(&pool, user_id, out, Some(groceries))
            .await?
            .is_empty()
    );

    assert_eq!(row(&pool, out).await?.1, None);
    assert_eq!(row(&pool, inn).await?.1, None);
    Ok(())
}

// ---------------------------------------------------------------------------
// Counting before writing
//
// "Select all shown" resolves server-side and may be years of rows the client
// has never loaded, so it cannot count the pairs it is about to break. The
// server counts them, and a caller that has not confirmed writes nothing.
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "../migrations")]
async fn counts_the_pairs_a_write_would_break(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, out, inn) = seeded_pair(&pool).await?;

    assert_eq!(count_paired(&pool, user_id, &[out]).await?, 1);
    assert_eq!(
        count_paired(&pool, user_id, &[out, inn]).await?,
        2,
        "both halves count: the modal reports rows affected, not pairs"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn an_unpaired_selection_counts_nothing(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, a, _b) = two_accounts(&pool, "EUR").await?;
    let lonely = tx_at(&pool, a, "acct-a", "x1", Decimal::new(-1200, 2), Utc::now()).await?;

    assert_eq!(count_paired(&pool, user_id, &[lonely]).await?, 0);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn another_users_pairs_are_not_counted(pool: PgPool) -> anyhow::Result<()> {
    let (_user_id, out, _inn) = seeded_pair(&pool).await?;

    assert_eq!(count_paired(&pool, Uuid::new_v4(), &[out]).await?, 0);
    Ok(())
}
