mod common;

use chrono::NaiveDate;
use common::{cash_holding, checking_account, equity_holding, seed_connection, stamp_on, txn_on};
use gripsou_core::backfill::backfill_connection;
use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::holding::upsert_holding;
use gripsou_core::repo::instrument::resolve_instrument;
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

fn pea_account(external_id: &str) -> CanonicalAccount {
    CanonicalAccount {
        type_key: "pea".to_string(),
        ..checking_account(external_id)
    }
}

/// Seed one cash holding on `acct`, its snapshot on `snapshot_day`, and return
/// (account_id, holding_id).
async fn seed_cash(
    pool: &PgPool,
    conn_id: Uuid,
    acct: &CanonicalAccount,
    balance: Decimal,
    snapshot_day: NaiveDate,
) -> (Uuid, Uuid) {
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, acct).await.unwrap();
    let instrument_id = resolve_instrument(
        &mut conn,
        &InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: "Euro".into(),
            currency: "EUR".into(),
        },
    )
    .await
    .unwrap();
    let holding_id = upsert_holding(
        &mut conn,
        account_id,
        instrument_id,
        &cash_holding(&acct.external_id, balance),
    )
    .await
    .unwrap();
    stamp_on(pool, holding_id, snapshot_day, balance, balance, balance).await;
    (account_id, holding_id)
}

async fn quantity_on(pool: &PgPool, holding_id: Uuid, day: NaiveDate) -> Option<Decimal> {
    sqlx::query_scalar("select quantity from holding_point where holding_id = $1 and as_of = $2")
        .bind(holding_id)
        .bind(day)
        .fetch_optional(pool)
        .await
        .unwrap()
}

async fn backfill_rows_on(pool: &PgPool, holding_id: Uuid, day: NaiveDate) -> i64 {
    sqlx::query_scalar("select count(*) from holding_backfill where holding_id = $1 and as_of = $2")
        .bind(holding_id)
        .bind(day)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn cost_basis_on(pool: &PgPool, holding_id: Uuid, day: NaiveDate) -> Option<Decimal> {
    sqlx::query_scalar("select cost_basis from holding_point where holding_id = $1 and as_of = $2")
        .bind(holding_id)
        .bind(day)
        .fetch_optional(pool)
        .await
        .unwrap()
}

/// A row of `(as_of, quantity, value, cost_basis)`, ordered by day. Comparing
/// this vector between two runs (rather than just row counts) is what makes
/// an idempotence test actually catch a value-shifting bug.
async fn backfill_digest(
    pool: &PgPool,
    holding_id: Uuid,
) -> Vec<(NaiveDate, Decimal, Decimal, Decimal)> {
    sqlx::query_as(
        "select as_of, quantity, value, cost_basis from holding_backfill \
         where holding_id = $1 order by as_of",
    )
    .bind(holding_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Insert a `buy` transaction row with an instrument attached directly.
/// `upsert_transaction` always writes a null `instrument_id` (Powens never
/// links one, §2.1); a test that needs a lot on the security walk must
/// insert the row itself, same as the seed binary does.
async fn insert_buy(
    pool: &PgPool,
    account_id: Uuid,
    instrument_id: Uuid,
    external_id: &str,
    quantity: Decimal,
    unit_price: Decimal,
    day: NaiveDate,
) {
    sqlx::query(
        "insert into transaction \
             (account_id, instrument_id, ts, type, quantity, unit_price, amount, external_id) \
         values ($1, $2, $3, 'buy', $4, $5, $6, $7)",
    )
    .bind(account_id)
    .bind(instrument_id)
    .bind(day.and_hms_opt(12, 0, 0).unwrap().and_utc())
    .bind(quantity)
    .bind(unit_price)
    .bind(-(quantity * unit_price))
    .bind(external_id)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = "../migrations")]
async fn walks_cash_backward_from_the_later_snapshot(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    // Balance is 100 on the 10th, after a +30 deposit on the 5th and a -10 fee
    // on the 8th. So it was 110 on the 5th..7th and 80 before the deposit.
    let (_account_id, holding_id) =
        seed_cash(&pool, conn_id, &acct, dec("100"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    for t in [
        txn_on("acct-1", "t1", "deposit", dec("30"), d(2026, 1, 5)),
        txn_on("acct-1", "t2", "fee", dec("-10"), d(2026, 1, 8)),
    ] {
        upsert_transaction(&mut conn, account_id, &t).await?;
    }

    let written = backfill_connection(&mut conn, conn_id).await?;
    assert!(written > 0, "backfill wrote nothing");

    // A movement dated `d` is already in the balance *on* `d`, so it is undone
    // only when walking past it to `d-1`.
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 9)).await,
        Some(dec("100"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 8)).await,
        Some(dec("100"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 7)).await,
        Some(dec("110"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 5)).await,
        Some(dec("110"))
    );
    // Flat before the earliest transaction (§3 rule 3).
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("80"))
    );
    // The snapshot day itself keeps its snapshot and gains no derived row.
    assert_eq!(
        backfill_rows_on(&pool, holding_id, d(2026, 1, 10)).await,
        0,
        "a day with a snapshot never gets a backfill row"
    );
    Ok(())
}

/// §8.1: on a PEA, transfer/buy/sell do not move the cash line — the money they
/// represent is already accounted for in the checking account or in the
/// security holding, and the PEA's history is too short to reconcile.
#[sqlx::test(migrations = "../migrations")]
async fn pea_cash_ignores_transfer_buy_and_sell(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = pea_account("pea-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("50"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    for t in [
        txn_on("pea-1", "t1", "transfer", dec("500"), d(2026, 1, 5)),
        txn_on("pea-1", "t2", "buy", dec("-480"), d(2026, 1, 6)),
        txn_on("pea-1", "t3", "sell", dec("100"), d(2026, 1, 7)),
        txn_on("pea-1", "t4", "dividend", dec("12"), d(2026, 1, 8)),
    ] {
        upsert_transaction(&mut conn, account_id, &t).await?;
    }
    backfill_connection(&mut conn, conn_id).await?;

    // Only the dividend moves the line: 50 today, 38 before it arrived.
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 8)).await,
        Some(dec("50"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 7)).await,
        Some(dec("38"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("38"))
    );
    Ok(())
}

/// The same three types on a non-PEA account count normally: there the history
/// is complete, so a buy really did move cash out.
#[sqlx::test(migrations = "../migrations")]
async fn non_pea_accounts_count_every_type(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("50"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on("acct-1", "t1", "transfer", dec("-500"), d(2026, 1, 5)),
    )
    .await?;
    backfill_connection(&mut conn, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("550"))
    );
    Ok(())
}

/// Gaps *between* sparse snapshots are filled too, each from its own later
/// anchor — not from today (§3 anchoring).
#[sqlx::test(migrations = "../migrations")]
async fn fills_gaps_between_snapshots_from_the_nearest_later_anchor(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("100"), d(2026, 1, 10)).await;
    // A second, later snapshot with a different balance and no transaction to
    // explain the difference: each gap must resolve against its own anchor.
    stamp_on(
        &pool,
        holding_id,
        d(2026, 1, 20),
        dec("300"),
        dec("300"),
        dec("300"),
    )
    .await;

    let mut conn = pool.acquire().await?;
    backfill_connection(&mut conn, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 15)).await,
        Some(dec("300"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 9)).await,
        Some(dec("100"))
    );
    // Neither snapshot day may also carry a derived row (the holding_point
    // invariant: summing it would double-count the holding that day).
    assert_eq!(backfill_rows_on(&pool, holding_id, d(2026, 1, 10)).await, 0);
    assert_eq!(backfill_rows_on(&pool, holding_id, d(2026, 1, 20)).await, 0);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn is_idempotent_and_reflects_a_corrected_amount(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("100"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on("acct-1", "t1", "deposit", dec("30"), d(2026, 1, 5)),
    )
    .await?;

    let first = backfill_connection(&mut conn, conn_id).await?;
    let first_digest = backfill_digest(&pool, holding_id).await;
    let second = backfill_connection(&mut conn, conn_id).await?;
    let second_digest = backfill_digest(&pool, holding_id).await;
    assert_eq!(first, second, "re-running writes the same number of rows");
    assert_eq!(
        first_digest, second_digest,
        "re-running derives the same (as_of, quantity, value, cost_basis) rows, \
         not just the same row count"
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("70"))
    );

    // Powens corrects the amount after the fact; history must move with it.
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on("acct-1", "t1", "deposit", dec("50"), d(2026, 1, 5)),
    )
    .await?;
    backfill_connection(&mut conn, conn_id).await?;
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("50"))
    );
    Ok(())
}

/// Regression: §8.2's cost-basis subquery must filter buys by
/// `t.account_id = w.account_id` in addition to instrument. Without the
/// account filter, a different user's buy of the *same* instrument bleeds
/// into this user's derived cost basis — a cross-user data leak.
#[sqlx::test(migrations = "../migrations")]
async fn cost_basis_ignores_another_users_buys_of_the_same_instrument(
    pool: PgPool,
) -> anyhow::Result<()> {
    // User A: holds ACME, cost_basis 1000, one buy of 4 @ 50 on 2026-01-06.
    let conn_a = seed_connection(&pool).await;
    let acct_a = checking_account("acct-a");
    let mut conn = pool.acquire().await?;
    let account_a = upsert_account(&mut conn, conn_a, &acct_a).await?;
    let instrument_id = resolve_instrument(
        &mut conn,
        &InstrumentRef {
            kind: "equity".into(),
            symbol: Some("ACME".into()),
            isin: Some("ACMEISIN0001".into()),
            name: "Acme Corp".into(),
            currency: "USD".into(),
        },
    )
    .await?;
    let holding_a = upsert_holding(
        &mut conn,
        account_a,
        instrument_id,
        &equity_holding("acct-a", "ACMEISIN0001", dec("4"), dec("1000"), None),
    )
    .await?;
    stamp_on(
        &pool,
        holding_a,
        d(2026, 1, 10),
        dec("4"),
        dec("0"),
        dec("1000"),
    )
    .await;
    insert_buy(
        &pool,
        account_a,
        instrument_id,
        "buy-a",
        dec("4"),
        dec("50"),
        d(2026, 1, 6),
    )
    .await;

    // User B: a DIFFERENT user, connection, and account — buys 5 @ 100 of the
    // exact same instrument on 2026-01-08.
    let conn_b = seed_connection(&pool).await;
    let acct_b = checking_account("acct-b");
    let account_b = upsert_account(&mut conn, conn_b, &acct_b).await?;
    insert_buy(
        &pool,
        account_b,
        instrument_id,
        "buy-b",
        dec("5"),
        dec("100"),
        d(2026, 1, 8),
    )
    .await;

    backfill_connection(&mut conn, conn_a).await?;

    // Without the account filter, B's buy (ts date 01-08, > 01-07) would be
    // subtracted too: 1000 - 500 = 500 instead of 1000.
    assert_eq!(
        cost_basis_on(&pool, holding_a, d(2026, 1, 7)).await,
        Some(dec("1000")),
        "user B's later buy of the same instrument must not affect A's cost basis"
    );
    // Without the account filter, both buys (200 + 500) would be subtracted:
    // 1000 - 700 = 300 instead of 800.
    assert_eq!(
        cost_basis_on(&pool, holding_a, d(2026, 1, 5)).await,
        Some(dec("800")),
        "only A's own buy (4 @ 50 = 200) should be subtracted here"
    );
    Ok(())
}

/// §3 rule 3 / this fix: `transaction` carries no currency, so the cash walk
/// only applies to the cash holding whose instrument currency matches the
/// account's own currency — the line the provider denominates `amount` in.
/// A second cash holding on the same account, in another currency, has no
/// evidence and must be held flat at its anchor.
#[sqlx::test(migrations = "../migrations")]
async fn cash_walk_is_scoped_to_the_accounts_own_currency(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1"); // currency EUR
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;

    let eur_instrument = resolve_instrument(
        &mut conn,
        &InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: "Euro".into(),
            currency: "EUR".into(),
        },
    )
    .await?;
    let eur_holding = upsert_holding(
        &mut conn,
        account_id,
        eur_instrument,
        &cash_holding("acct-1", dec("100")),
    )
    .await?;
    stamp_on(
        &pool,
        eur_holding,
        d(2026, 1, 10),
        dec("100"),
        dec("100"),
        dec("100"),
    )
    .await;

    let usd_instrument = resolve_instrument(
        &mut conn,
        &InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: "US Dollar".into(),
            currency: "USD".into(),
        },
    )
    .await?;
    let usd_holding = upsert_holding(
        &mut conn,
        account_id,
        usd_instrument,
        &CanonicalHolding {
            account_external_id: "acct-1".to_string(),
            instrument: InstrumentRef {
                kind: "cash".into(),
                symbol: None,
                isin: None,
                name: "US Dollar".into(),
                currency: "USD".into(),
            },
            quantity: dec("50"),
            cost_basis: dec("50"),
            valuation: None,
        },
    )
    .await?;
    stamp_on(
        &pool,
        usd_holding,
        d(2026, 1, 10),
        dec("50"),
        dec("50"),
        dec("50"),
    )
    .await;

    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on("acct-1", "t1", "deposit", dec("30"), d(2026, 1, 5)),
    )
    .await?;

    backfill_connection(&mut conn, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, eur_holding, d(2026, 1, 4)).await,
        Some(dec("70")),
        "the EUR line matches the account's currency and moves with the transaction"
    );
    assert_eq!(
        quantity_on(&pool, usd_holding, d(2026, 1, 4)).await,
        Some(dec("50")),
        "the USD line has no matching evidence and stays flat at its anchor"
    );
    Ok(())
}

/// Two accounts on the same connection, each with its own cash holding and
/// its own transactions: covers the scope × horizon cross join, the
/// per-holding `moves` grouping, and the delete's connection scoping. Also
/// checks that a pre-existing `holding_backfill` row belonging to a
/// DIFFERENT connection survives this connection's delete-and-refill.
#[sqlx::test(migrations = "../migrations")]
async fn multi_account_backfill_is_scoped_per_account_and_per_connection(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct1 = checking_account("acct-1");
    let (_a1, holding1) = seed_cash(&pool, conn_id, &acct1, dec("100"), d(2026, 1, 10)).await;
    let acct2 = checking_account("acct-2");
    let (account2, holding2) = seed_cash(&pool, conn_id, &acct2, dec("200"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account1 = upsert_account(&mut conn, conn_id, &acct1).await?;
    upsert_transaction(
        &mut conn,
        account1,
        &txn_on("acct-1", "t1", "deposit", dec("30"), d(2026, 1, 5)),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        account2,
        &txn_on("acct-2", "t2", "withdrawal", dec("-40"), d(2026, 1, 5)),
    )
    .await?;

    // A pre-existing backfill row belonging to a DIFFERENT connection must
    // survive this connection's delete-and-refill.
    let other_conn = seed_connection(&pool).await;
    let other_acct = checking_account("other-acct");
    let (other_account, other_holding) =
        seed_cash(&pool, other_conn, &other_acct, dec("999"), d(2026, 1, 10)).await;
    upsert_transaction(
        &mut conn,
        other_account,
        &txn_on("other-acct", "t3", "deposit", dec("5"), d(2026, 1, 5)),
    )
    .await?;
    backfill_connection(&mut conn, other_conn).await?;
    let other_before = backfill_rows_on(&pool, other_holding, d(2026, 1, 4)).await;
    assert!(
        other_before > 0,
        "sanity: the other connection produced rows"
    );

    backfill_connection(&mut conn, conn_id).await?;

    // Each holding's derived series reflects only its own account's txns.
    assert_eq!(
        quantity_on(&pool, holding1, d(2026, 1, 4)).await,
        Some(dec("70"))
    );
    assert_eq!(
        quantity_on(&pool, holding2, d(2026, 1, 4)).await,
        Some(dec("240"))
    );

    // Untouched by conn_id's delete-and-refill.
    assert_eq!(
        backfill_rows_on(&pool, other_holding, d(2026, 1, 4)).await,
        other_before
    );
    Ok(())
}

/// §3: the horizon is the whole user's, not one connection's. Powens connectors
/// expose wildly different history depths (the PEA's is ~8 months), and the
/// read-side lateral is an inner join, so a holding contributes nothing before
/// its first derived row — a per-connection horizon draws each bank popping
/// into existence on a different day and steps net worth up as it goes.
#[sqlx::test(migrations = "../migrations")]
async fn horizon_spans_every_connection_of_the_user(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, shallow_conn) = common::seed_user_and_connection(&pool).await;
    let deep_conn = common::seed_connection_for(&pool, user_id).await;

    // Shallow connection: balance 100 on 2026-01-10, +30 deposit on 2026-01-05.
    let shallow_acct = checking_account("shallow-1");
    let (shallow_account_id, shallow_holding) = seed_cash(
        &pool,
        shallow_conn,
        &shallow_acct,
        dec("100"),
        d(2026, 1, 10),
    )
    .await;

    // Deep connection: same snapshot day, but its history reaches back to June.
    let deep_acct = checking_account("deep-1");
    let (deep_account_id, _deep_holding) =
        seed_cash(&pool, deep_conn, &deep_acct, dec("50"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    upsert_transaction(
        &mut conn,
        shallow_account_id,
        &txn_on("shallow-1", "s1", "deposit", dec("30"), d(2026, 1, 5)),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        deep_account_id,
        &txn_on("deep-1", "d1", "deposit", dec("5"), d(2025, 6, 1)),
    )
    .await?;

    backfill_connection(&mut conn, shallow_conn).await?;

    // Held flat by §3 rule 3 all the way back to the deep connection's horizon.
    assert_eq!(
        quantity_on(&pool, shallow_holding, d(2025, 5, 31)).await,
        Some(dec("70")),
        "the shallow connection must be filled back to the user's earliest evidence"
    );
    assert_eq!(
        quantity_on(&pool, shallow_holding, d(2025, 6, 1)).await,
        Some(dec("70"))
    );
    assert_eq!(
        quantity_on(&pool, shallow_holding, d(2026, 1, 4)).await,
        Some(dec("70"))
    );
    // Nothing earlier than the user's own earliest evidence, minus the one
    // leading day that makes the flat tail visible.
    assert_eq!(
        quantity_on(&pool, shallow_holding, d(2025, 5, 30)).await,
        None
    );
    Ok(())
}

/// Another user's deeper history must not widen this user's horizon.
#[sqlx::test(migrations = "../migrations")]
async fn horizon_ignores_other_users(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("mine-1");
    let (account_id, holding_id) =
        seed_cash(&pool, conn_id, &acct, dec("100"), d(2026, 1, 10)).await;

    let other_conn = seed_connection(&pool).await;
    let other_acct = checking_account("theirs-1");
    let (other_account_id, _) =
        seed_cash(&pool, other_conn, &other_acct, dec("10"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on("mine-1", "m1", "deposit", dec("30"), d(2026, 1, 5)),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        other_account_id,
        &txn_on("theirs-1", "o1", "deposit", dec("5"), d(2020, 1, 1)),
    )
    .await?;

    backfill_connection(&mut conn, conn_id).await?;
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("70"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2020, 1, 1)).await,
        None,
        "another user's history must not widen this user's horizon"
    );
    Ok(())
}

/// The walk must follow the day the balance moved, not the day the card was
/// tapped. Here a −30 card purchase is spent on the 5th but booked on the 8th,
/// with a snapshot of 100 on the 10th. The balance only dropped on the 8th, so
/// days 8 and 9 read 100 and days 5-7 read 130 — keying on `ts` instead would
/// subtract it three days early and report 130 on the 8th and 9th.
#[sqlx::test(migrations = "../migrations")]
async fn walks_on_the_booking_date_not_the_spend_date(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("100"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &common::txn_booked(
            "acct-1",
            "t1",
            "withdrawal",
            dec("-30"),
            d(2026, 1, 5),
            d(2026, 1, 8),
        ),
    )
    .await?;
    backfill_connection(&mut conn, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 9)).await,
        Some(dec("100"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 8)).await,
        Some(dec("100"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 7)).await,
        Some(dec("130")),
        "the balance had not yet dropped on the 7th"
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 5)).await,
        Some(dec("130"))
    );
    Ok(())
}

/// The reconciliation invariant: with a complete ledger, walking back from a
/// later snapshot must land exactly on the earlier one. This is the property
/// the real data violates by 4.50 over 18 days on CPT COURANT, and the reason
/// derived cash goes negative.
#[sqlx::test(migrations = "../migrations")]
async fn walking_back_from_a_later_snapshot_reproduces_the_earlier_one(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    // Balance 100 on the 1st, 85 on the 10th. Booked movements between them:
    // −30 (booked 4th), +20 (booked 6th), −5 (booked 9th) = −15. 100 − 15 = 85.
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("85"), d(2026, 1, 10)).await;
    stamp_on(
        &pool,
        holding_id,
        d(2026, 1, 1),
        dec("100"),
        dec("100"),
        dec("100"),
    )
    .await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    for (id, amount, spent, booked) in [
        ("t1", "-30", d(2026, 1, 2), d(2026, 1, 4)),
        ("t2", "20", d(2026, 1, 6), d(2026, 1, 6)),
        ("t3", "-5", d(2026, 1, 7), d(2026, 1, 9)),
    ] {
        upsert_transaction(
            &mut conn,
            account_id,
            &common::txn_booked("acct-1", id, "withdrawal", dec(amount), spent, booked),
        )
        .await?;
    }
    backfill_connection(&mut conn, conn_id).await?;

    // The derived day immediately after the earlier snapshot must agree with it:
    // nothing was booked on the 2nd, so the balance is still 100.
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 2)).await,
        Some(dec("100")),
        "the walk back from the 10th must reconcile with the snapshot on the 1st"
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("70"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 6)).await,
        Some(dec("90"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 9)).await,
        Some(dec("85"))
    );
    Ok(())
}

/// Some banks do not send a booking date at all: they send the *statement
/// period* every row landed in. LIVRET A stamps a whole fortnight of movements
/// on the 1st or the 16th, which collapses them onto one day and craters the
/// days just before it (−131.13 on four days of real data).
///
/// The tell is a row whose money supposedly moved *before* it was spent, which
/// cannot happen — 123 of LIVRET A's 167 rows do it. When an account shows that
/// signature, the whole account is walked on the spend date instead.
#[sqlx::test(migrations = "../migrations")]
async fn a_bank_that_sends_statement_periods_is_walked_on_the_spend_date(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    // Opening 0, then +300 (spent the 4th), −240 (spent the 10th), −40 (spent
    // the 19th) leaves 20 on the 20th. The bank stamps them onto two statement
    // days: the 1st and the 16th.
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("20"), d(2026, 1, 20)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    for (id, amount, spent, booked) in [
        ("t1", "300", d(2026, 1, 4), d(2026, 1, 16)),
        ("t2", "-240", d(2026, 1, 10), d(2026, 1, 1)),
        // Booked before it was spent: the signature of a statement period.
        ("t3", "-40", d(2026, 1, 19), d(2026, 1, 16)),
    ] {
        upsert_transaction(
            &mut conn,
            account_id,
            &common::txn_booked("acct-1", id, "transfer", dec(amount), spent, booked),
        )
        .await?;
    }
    backfill_connection(&mut conn, conn_id).await?;

    // On the statement dates the batch nets +260, so keying on them puts the
    // 15th at 20 − 260 = −240. Keyed on the spend date only the −40 of the 19th
    // is still ahead, so the balance was 60.
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 15)).await,
        Some(dec("60")),
        "the statement date must be ignored on an account that sends them"
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 9)).await,
        Some(dec("300")),
        "before the −240 was spent"
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 3)).await,
        Some(dec("0")),
        "the walk must still land on the opening balance"
    );
    Ok(())
}

/// The earliest snapshot anchors every derived day before it, so a
/// reconciliation gap on that one day becomes a constant bias over the whole
/// history. Revolut's first snapshot is 10.00 below its own ledger — one card
/// payment the balance had already taken and the bank had not yet booked — and
/// that 10.00 pushed 1,221 derived days below zero.
///
/// A balance cannot be negative, and the error is a constant, so each anchored
/// stretch that dips below zero is lifted by its own shortfall: the shape of
/// the line is untouched, it just sits at the right height.
#[sqlx::test(migrations = "../migrations")]
async fn a_stretch_that_dips_below_zero_is_lifted_to_it(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    // The snapshot says 0 on the 10th, but the ledger says the +50 of the 5th
    // should have left it at 50 — the balance had already taken a −50 the bank
    // has not reported. Walking back naively puts everything before the 5th at
    // −50.
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("0"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on("acct-1", "t1", "deposit", dec("50"), d(2026, 1, 5)),
    )
    .await?;
    backfill_connection(&mut conn, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("0")),
        "the shortfall is lifted away instead of showing as a negative balance"
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 9)).await,
        Some(dec("50")),
        "the whole stretch rises by the same amount, so the step of the 5th survives"
    );
    let negatives: i64 = sqlx::query_scalar(
        "select count(*) from holding_backfill where holding_id = $1 and quantity < 0",
    )
    .bind(holding_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(negatives, 0);
    Ok(())
}

/// The lift is per anchored stretch, not per holding: a gap between two sound
/// snapshots must not be dragged up by a shortfall on some older one.
#[sqlx::test(migrations = "../migrations")]
async fn a_sound_stretch_is_not_lifted_by_another_ones_shortfall(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    // Snapshot 0 on the 10th (short by 50, as above) and 80 on the 20th, with a
    // +80 on the 15th that reconciles the later pair exactly.
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("80"), d(2026, 1, 20)).await;
    stamp_on(
        &pool,
        holding_id,
        d(2026, 1, 10),
        dec("0"),
        dec("0"),
        dec("0"),
    )
    .await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    for (id, amount, day) in [("t1", "50", d(2026, 1, 5)), ("t2", "80", d(2026, 1, 15))] {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn_on("acct-1", id, "deposit", dec(amount), day),
        )
        .await?;
    }
    backfill_connection(&mut conn, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 14)).await,
        Some(dec("0")),
        "this stretch never went negative, so it must be left exactly where it was"
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("0")),
        "while the older stretch is still lifted"
    );
    Ok(())
}
