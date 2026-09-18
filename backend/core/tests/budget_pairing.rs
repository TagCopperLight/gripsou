mod common;

use chrono::{DateTime, Duration, Utc};
use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::budget::pairing::pair_internal_transfers;
use gripsou_core::dto::CanonicalAccount;
use gripsou_core::error::CoreError;
use gripsou_core::repo::account::upsert_account;
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

/// Inserts a transaction at an explicit instant.
async fn tx_at(
    pool: &PgPool,
    account_id: Uuid,
    account_ext: &str,
    ext: &str,
    amount: Decimal,
    ts: DateTime<Utc>,
) -> anyhow::Result<Uuid> {
    let kind = if amount < Decimal::ZERO {
        "withdrawal"
    } else {
        "deposit"
    };
    tx_at_kind(pool, account_id, account_ext, ext, kind, amount, ts).await
}

/// Same as [`tx_at`], but with an explicit transaction `type` rather than the
/// deposit/withdrawal default — needed to seed a `buy`, `sell`, `dividend`,
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
        now + Duration::days(4),
    )
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
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

/// Precedence (spec §4, `user > rule > pair > ai`): pairing is allowed to
/// overwrite an AI guess, since pairing outranks it, but never a `user` or
/// `rule` categorisation. This would fail (leaving the AI row unpaired) if
/// the candidate filter reverted to `category_source is null` only.
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
        "update transaction set budget_category_id = $1, category_source = 'ai' where id = $2",
    )
    .bind(groceries)
    .bind(out)
    .execute(&pool)
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 1);

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

/// Precedence: a row the user categorised is never touched by the pass.
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
    let savings = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("savings"))
        .unwrap()
        .id;
    sqlx::query(
        "update transaction set budget_category_id = $1, category_source = 'user' where id = $2",
    )
    .bind(savings)
    .bind(out)
    .execute(&pool)
    .await?;

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

/// Precedence: a row a rule categorised outranks pairing too, and is never
/// touched by the pass — same as `user`, unlike `ai`.
#[sqlx::test(migrations = "../migrations")]
async fn a_rule_categorised_row_is_left_alone(pool: PgPool) -> anyhow::Result<()> {
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
    let savings = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("savings"))
        .unwrap()
        .id;
    sqlx::query(
        "update transaction set budget_category_id = $1, category_source = 'rule' where id = $2",
    )
    .bind(savings)
    .bind(out)
    .execute(&pool)
    .await?;

    let mut conn = pool.acquire().await?;
    assert_eq!(pair_internal_transfers(&mut conn, user_id).await?, 0);
    let still: Option<String> =
        sqlx::query_scalar("select category_source from transaction where id = $1")
            .bind(out)
            .fetch_one(&pool)
            .await?;
    assert_eq!(still.as_deref(), Some("rule"));
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
