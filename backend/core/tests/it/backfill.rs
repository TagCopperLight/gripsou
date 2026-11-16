use chrono::NaiveDate;
use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::holding::upsert_holding;
use gripsou_core::repo::instrument::resolve_instrument;
use gripsou_core::repo::transaction::upsert_transaction;
use gripsou_core::testkit::{
    self, Lot, cash_holding, checking_account, equity_holding, seed_connection, stamp_on, txn,
};
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
    stamp_on(pool, holding_id, snapshot_day, balance, balance).await;
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

async fn backfill_digest(pool: &PgPool, holding_id: Uuid) -> Vec<(NaiveDate, Decimal, Decimal)> {
    sqlx::query_as(
        "select as_of, quantity, value from holding_backfill \
         where holding_id = $1 order by as_of",
    )
    .bind(holding_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[gripsou_core::testkit::db_test]
async fn walks_cash_backward_from_the_later_snapshot(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_account_id, holding_id) =
        seed_cash(&pool, conn_id, &acct, dec("100"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    for t in [
        txn("acct-1", "t1", "deposit", dec("30")).on(d(2026, 1, 5)),
        txn("acct-1", "t2", "fee", dec("-10")).on(d(2026, 1, 8)),
    ] {
        upsert_transaction(&mut conn, account_id, &t).await?;
    }

    let written = testkit::backfill(&pool, conn_id).await?;
    assert!(written > 0, "backfill wrote nothing");

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
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("80"))
    );
    assert_eq!(
        backfill_rows_on(&pool, holding_id, d(2026, 1, 10)).await,
        0,
        "a day with a snapshot never gets a backfill row"
    );
    Ok(())
}

/// A PEA counts every type like any other account: each provider buy is funded by a transfer-in on record.
#[gripsou_core::testkit::db_test]
async fn pea_cash_counts_transfer_buy_and_sell(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = pea_account("pea-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("150"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    for t in [
        txn("pea-1", "t1", "transfer", dec("500")).on(d(2026, 1, 5)),
        txn("pea-1", "t2", "buy", dec("-480")).on(d(2026, 1, 6)),
        txn("pea-1", "t3", "sell", dec("100")).on(d(2026, 1, 7)),
        txn("pea-1", "t4", "dividend", dec("12")).on(d(2026, 1, 8)),
    ] {
        upsert_transaction(&mut conn, account_id, &t).await?;
    }
    testkit::backfill(&pool, conn_id).await?;

    for (day, want) in [(8, "150"), (7, "138"), (6, "38"), (5, "518"), (4, "18")] {
        assert_eq!(
            quantity_on(&pool, holding_id, d(2026, 1, day)).await,
            Some(dec(want)),
            "2026-01-{day:02}"
        );
    }
    Ok(())
}

async fn seed_lot(
    pool: &PgPool,
    account_id: Uuid,
    isin: &str,
    day: NaiveDate,
    (quantity, unit_price, fee): (&str, &str, &str),
) {
    let mut conn = pool.acquire().await.unwrap();
    let mut h = equity_holding("pea-1", isin, dec(quantity), dec("0"), None);
    h.instrument.currency = "EUR".into();
    let instrument_id = resolve_instrument(&mut conn, &h.instrument).await.unwrap();
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &h)
        .await
        .unwrap();
    testkit::seed_lot(
        pool,
        holding_id,
        Lot::buy(day, dec(quantity), dec(unit_price)).fee(dec(fee)),
    )
    .await;
}

async fn manual_txn(pool: &PgPool, account_id: Uuid, kind: &str, amount: &str, day: NaiveDate) {
    sqlx::query(
        "insert into transaction (account_id, spent_on, booked_on, type, amount, description) \
         values ($1, $2, $2, $3, $4, 'manual')",
    )
    .bind(account_id)
    .bind(day)
    .bind(kind)
    .bind(dec(amount))
    .execute(pool)
    .await
    .unwrap();
}

/// Before the provider's history starts the user's own record explains the cash; after it, the provider's buy row is the cash leg and the lot must not count again.
#[gripsou_core::testkit::db_test]
async fn lots_move_cash_before_the_provider_history_when_deposits_were_entered(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = pea_account("pea-1");
    let (account_id, cash_id) = seed_cash(&pool, conn_id, &acct, dec("4.35"), d(2026, 1, 20)).await;

    let mut conn = pool.acquire().await?;
    for t in [
        txn("pea-1", "t1", "transfer", dec("50")).on(d(2026, 1, 14)),
        txn("pea-1", "t2", "buy", dec("-108.25")).on(d(2026, 1, 16)),
    ] {
        upsert_transaction(&mut conn, account_id, &t).await?;
    }
    seed_lot(
        &pool,
        account_id,
        "FR0000000001",
        d(2026, 1, 16),
        ("6", "17.95", "0.55"),
    )
    .await;
    manual_txn(&pool, account_id, "transfer", "55", d(2025, 12, 2)).await;
    seed_lot(
        &pool,
        account_id,
        "FR0000000002",
        d(2025, 12, 2),
        ("19", "5.316", "0.51"),
    )
    .await;

    testkit::backfill(&pool, conn_id).await?;

    for (day, want) in [
        (d(2026, 1, 15), "112.60"),
        (d(2026, 1, 13), "62.60"),
        (d(2025, 12, 2), "62.60"),
        (d(2025, 12, 1), "109.114"),
    ] {
        assert_eq!(
            quantity_on(&pool, cash_id, day).await,
            Some(dec(want)),
            "{day}"
        );
    }
    Ok(())
}

/// Lots alone leave the pre-history cash flat: counting only the purchases would inflate it.
#[gripsou_core::testkit::db_test]
async fn lots_alone_do_not_move_cash_before_the_provider_history(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = pea_account("pea-1");
    let (account_id, cash_id) =
        seed_cash(&pool, conn_id, &acct, dec("54.40"), d(2026, 1, 20)).await;

    let mut conn = pool.acquire().await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("pea-1", "t1", "transfer", dec("50")).on(d(2026, 1, 14)),
    )
    .await?;
    seed_lot(
        &pool,
        account_id,
        "FR0000000002",
        d(2025, 12, 2),
        ("19", "5.316", "0.51"),
    )
    .await;

    testkit::backfill(&pool, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, cash_id, d(2025, 12, 1)).await,
        Some(dec("4.40"))
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn non_pea_accounts_count_every_type(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("50"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "t1", "transfer", dec("-500")).on(d(2026, 1, 5)),
    )
    .await?;
    testkit::backfill(&pool, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("550"))
    );
    Ok(())
}

/// Gaps between sparse snapshots are each filled from their own later anchor, not from today.
#[gripsou_core::testkit::db_test]
async fn fills_gaps_between_snapshots_from_the_nearest_later_anchor(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("100"), d(2026, 1, 10)).await;
    stamp_on(&pool, holding_id, d(2026, 1, 20), dec("300"), dec("300")).await;

    testkit::backfill(&pool, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 15)).await,
        Some(dec("300"))
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 9)).await,
        Some(dec("100"))
    );
    // No derived row on a snapshot day.
    assert_eq!(backfill_rows_on(&pool, holding_id, d(2026, 1, 10)).await, 0);
    assert_eq!(backfill_rows_on(&pool, holding_id, d(2026, 1, 20)).await, 0);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn is_idempotent_and_reflects_a_corrected_amount(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("100"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "t1", "deposit", dec("30")).on(d(2026, 1, 5)),
    )
    .await?;

    let first = testkit::backfill(&pool, conn_id).await?;
    let first_digest = backfill_digest(&pool, holding_id).await;
    let second = testkit::backfill(&pool, conn_id).await?;
    let second_digest = backfill_digest(&pool, holding_id).await;
    assert_eq!(first, second, "re-running writes the same number of rows");
    assert_eq!(
        first_digest, second_digest,
        "re-running derives the same (as_of, quantity, value) rows, \
         not just the same row count"
    );
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("70"))
    );

    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "t1", "deposit", dec("50")).on(d(2026, 1, 5)),
    )
    .await?;
    testkit::backfill(&pool, conn_id).await?;
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 1, 4)).await,
        Some(dec("50"))
    );
    Ok(())
}

/// `transaction` carries no currency, so only the cash holding in the account's own currency is walked; another-currency cash holding is held flat.
#[gripsou_core::testkit::db_test]
async fn cash_walk_is_scoped_to_the_accounts_own_currency(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
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
    stamp_on(&pool, eur_holding, d(2026, 1, 10), dec("100"), dec("100")).await;

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
    stamp_on(&pool, usd_holding, d(2026, 1, 10), dec("50"), dec("50")).await;

    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "t1", "deposit", dec("30")).on(d(2026, 1, 5)),
    )
    .await?;

    testkit::backfill(&pool, conn_id).await?;

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

/// Two accounts on one connection keep separate derived series; another user's backfill rows survive this user's refill.
#[gripsou_core::testkit::db_test]
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
        &txn("acct-1", "t1", "deposit", dec("30")).on(d(2026, 1, 5)),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        account2,
        &txn("acct-2", "t2", "withdrawal", dec("-40")).on(d(2026, 1, 5)),
    )
    .await?;

    let other_conn = seed_connection(&pool).await;
    let other_acct = checking_account("other-acct");
    let (other_account, other_holding) =
        seed_cash(&pool, other_conn, &other_acct, dec("999"), d(2026, 1, 10)).await;
    upsert_transaction(
        &mut conn,
        other_account,
        &txn("other-acct", "t3", "deposit", dec("5")).on(d(2026, 1, 5)),
    )
    .await?;
    testkit::backfill(&pool, other_conn).await?;
    let other_before = backfill_rows_on(&pool, other_holding, d(2026, 1, 4)).await;
    assert!(
        other_before > 0,
        "sanity: the other connection produced rows"
    );

    testkit::backfill(&pool, conn_id).await?;

    assert_eq!(
        quantity_on(&pool, holding1, d(2026, 1, 4)).await,
        Some(dec("70"))
    );
    assert_eq!(
        quantity_on(&pool, holding2, d(2026, 1, 4)).await,
        Some(dec("240"))
    );

    assert_eq!(
        backfill_rows_on(&pool, other_holding, d(2026, 1, 4)).await,
        other_before
    );
    Ok(())
}

/// The horizon is the whole user's, not one connection's: a per-connection horizon makes each bank pop into existence on a different day and steps net worth up.
#[gripsou_core::testkit::db_test]
async fn horizon_spans_every_connection_of_the_user(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, shallow_conn) = testkit::seed_user_and_connection(&pool).await;
    let deep_conn = testkit::seed_connection_for(&pool, user_id).await;

    let shallow_acct = checking_account("shallow-1");
    let (shallow_account_id, shallow_holding) = seed_cash(
        &pool,
        shallow_conn,
        &shallow_acct,
        dec("100"),
        d(2026, 1, 10),
    )
    .await;

    let deep_acct = checking_account("deep-1");
    let (deep_account_id, _deep_holding) =
        seed_cash(&pool, deep_conn, &deep_acct, dec("50"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    upsert_transaction(
        &mut conn,
        shallow_account_id,
        &txn("shallow-1", "s1", "deposit", dec("30")).on(d(2026, 1, 5)),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        deep_account_id,
        &txn("deep-1", "d1", "deposit", dec("5")).on(d(2025, 6, 1)),
    )
    .await?;

    testkit::backfill(&pool, shallow_conn).await?;

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
    assert_eq!(
        quantity_on(&pool, shallow_holding, d(2025, 5, 30)).await,
        None
    );
    Ok(())
}

/// Another user's deeper history must not widen this user's horizon.
#[gripsou_core::testkit::db_test]
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
        &txn("mine-1", "m1", "deposit", dec("30")).on(d(2026, 1, 5)),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        other_account_id,
        &txn("theirs-1", "o1", "deposit", dec("5")).on(d(2020, 1, 1)),
    )
    .await?;

    testkit::backfill(&pool, conn_id).await?;
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

/// The walk follows the day the balance moved (booked), not the day the card was tapped (spent).
#[gripsou_core::testkit::db_test]
async fn walks_on_the_booking_date_not_the_spend_date(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("100"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &testkit::txn("acct-1", "t1", "withdrawal", dec("-30"))
            .on(d(2026, 1, 5))
            .booked_on(d(2026, 1, 8)),
    )
    .await?;
    testkit::backfill(&pool, conn_id).await?;

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

/// Reconciliation: with a complete ledger, walking back from a later snapshot lands exactly on the earlier one.
#[gripsou_core::testkit::db_test]
async fn walking_back_from_a_later_snapshot_reproduces_the_earlier_one(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("85"), d(2026, 1, 10)).await;
    stamp_on(&pool, holding_id, d(2026, 1, 1), dec("100"), dec("100")).await;

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
            &testkit::txn("acct-1", id, "withdrawal", dec(amount))
                .on(spent)
                .booked_on(booked),
        )
        .await?;
    }
    testkit::backfill(&pool, conn_id).await?;

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

/// Some banks stamp a whole statement period's rows on one day. The tell is a row booked before it was spent; such an account is walked on the spend date.
#[gripsou_core::testkit::db_test]
async fn a_bank_that_sends_statement_periods_is_walked_on_the_spend_date(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("20"), d(2026, 1, 20)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    for (id, amount, spent, booked) in [
        ("t1", "300", d(2026, 1, 4), d(2026, 1, 16)),
        ("t2", "-240", d(2026, 1, 10), d(2026, 1, 1)),
        ("t3", "-40", d(2026, 1, 19), d(2026, 1, 16)),
    ] {
        upsert_transaction(
            &mut conn,
            account_id,
            &testkit::txn("acct-1", id, "transfer", dec(amount))
                .on(spent)
                .booked_on(booked),
        )
        .await?;
    }
    testkit::backfill(&pool, conn_id).await?;

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

/// A reconciliation gap on the earliest snapshot is a constant bias over the history, so each anchored stretch that dips below zero is lifted by its shortfall.
#[gripsou_core::testkit::db_test]
async fn a_stretch_that_dips_below_zero_is_lifted_to_it(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("0"), d(2026, 1, 10)).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "t1", "deposit", dec("50")).on(d(2026, 1, 5)),
    )
    .await?;
    testkit::backfill(&pool, conn_id).await?;

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

/// The lift is per anchored stretch, not per holding.
#[gripsou_core::testkit::db_test]
async fn a_sound_stretch_is_not_lifted_by_another_ones_shortfall(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_a, holding_id) = seed_cash(&pool, conn_id, &acct, dec("80"), d(2026, 1, 20)).await;
    stamp_on(&pool, holding_id, d(2026, 1, 10), dec("0"), dec("0")).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    for (id, amount, day) in [("t1", "50", d(2026, 1, 5)), ("t2", "80", d(2026, 1, 15))] {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn("acct-1", id, "deposit", dec(amount)).on(day),
        )
        .await?;
    }
    testkit::backfill(&pool, conn_id).await?;

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

/// A snapshot dated after today must not be dropped by the inner join against the day axis.
#[gripsou_core::testkit::db_test]
async fn anchors_on_a_snapshot_dated_after_today(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let today = chrono::Utc::now().date_naive();
    let future = today + chrono::Duration::days(5);

    let (account_id, holding_id) = seed_cash(&pool, conn_id, &acct, dec("1000"), future).await;

    let mut conn = pool.acquire().await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "past-1", "deposit", dec("100")).on(today - chrono::Duration::days(3)),
    )
    .await?;
    testkit::backfill(&pool, conn_id).await?;
    drop(conn);

    assert_eq!(
        quantity_on(&pool, holding_id, today - chrono::Duration::days(4)).await,
        Some(dec("900"))
    );
    Ok(())
}

/// The `axis` union with `moves` is load-bearing when `anchor_day > today`: a movement in `(today, anchor_day]` would otherwise have no axis row and its delta would be dropped.
#[gripsou_core::testkit::db_test]
async fn a_movement_between_today_and_a_future_anchor_is_still_subtracted(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let today = chrono::Utc::now().date_naive();
    let future_anchor = today + chrono::Duration::days(5);
    let (account_id, holding_id) =
        seed_cash(&pool, conn_id, &acct, dec("1000"), future_anchor).await;

    let mut conn = pool.acquire().await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "past-deposit", "deposit", dec("50")).on(today - chrono::Duration::days(10)),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "future-deposit", "deposit", dec("200"))
            .on(today + chrono::Duration::days(2)),
    )
    .await?;
    testkit::backfill(&pool, conn_id).await?;
    drop(conn);

    assert_eq!(
        quantity_on(&pool, holding_id, today).await,
        Some(dec("800")),
        "a movement between today and a future-dated anchor must still be subtracted"
    );
    Ok(())
}

/// A transaction dated after today must leave every derived day unchanged.
#[gripsou_core::testkit::db_test]
async fn a_future_dated_transaction_changes_nothing(pool: PgPool) -> anyhow::Result<()> {
    let today = chrono::Utc::now().date_naive();
    let anchor = today - chrono::Duration::days(2);

    let conn_a = seed_connection(&pool).await;
    let acct_a = checking_account("acct-a");
    let (account_a, holding_a) = seed_cash(&pool, conn_a, &acct_a, dec("1000"), anchor).await;

    let conn_b = seed_connection(&pool).await;
    let acct_b = checking_account("acct-b");
    let (account_b, holding_b) = seed_cash(&pool, conn_b, &acct_b, dec("1000"), anchor).await;

    let mut conn = pool.acquire().await?;
    for (account_id, tag) in [(account_a, "a"), (account_b, "b")] {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn(
                &format!("acct-{tag}"),
                &format!("shared-{tag}"),
                "deposit",
                dec("100"),
            )
            .on(today - chrono::Duration::days(10)),
        )
        .await?;
    }
    upsert_transaction(
        &mut conn,
        account_b,
        &txn("acct-b", "future-b", "deposit", dec("500")).on(today + chrono::Duration::days(7)),
    )
    .await?;
    testkit::backfill(&pool, conn_a).await?;
    testkit::backfill(&pool, conn_b).await?;
    drop(conn);

    let a = backfill_digest(&pool, holding_a).await;
    let b = backfill_digest(&pool, holding_b).await;
    assert!(!a.is_empty(), "the clean scenario must derive something");
    assert_eq!(
        a.len(),
        b.len(),
        "a future-dated transaction changed the number of derived days"
    );
    for (ra, rb) in a.iter().zip(b.iter()) {
        assert_eq!(ra.0, rb.0);
        assert_eq!(ra.1, rb.1, "quantity changed on {}", ra.0);
        assert_eq!(ra.2, rb.2, "value changed on {}", ra.0);
    }
    Ok(())
}

/// A movement on the anchor day is inside the walk's window; one on the day being computed is outside.
#[gripsou_core::testkit::db_test]
async fn movements_on_the_window_boundaries(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (account_id, holding_id) =
        seed_cash(&pool, conn_id, &acct, dec("1000"), d(2026, 8, 20)).await;

    let mut conn = pool.acquire().await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "on-anchor", "deposit", dec("100")).on(d(2026, 8, 20)),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "on-day", "deposit", dec("7")).on(d(2026, 8, 15)),
    )
    .await?;
    testkit::backfill(&pool, conn_id).await?;
    drop(conn);

    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 8, 15)).await,
        Some(dec("900"))
    );
    Ok(())
}

/// Pins the `uv` lateral's order: earliest non-zero snapshot strictly after the day, else latest at or before it.
/// Uses a security holding: for cash the final select never reads `uv`, so a cash case passes under either order.
#[gripsou_core::testkit::db_test]
async fn values_a_sold_position_from_before_the_sale(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;

    let h = equity_holding("acct-1", "IE0100", dec("0"), dec("0"), Some(dec("0")));
    let instrument_id = resolve_instrument(&mut conn, &h.instrument).await?;
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &h).await?;

    stamp_on(&pool, holding_id, d(2026, 7, 20), dec("40"), dec("400")).await;
    stamp_on(&pool, holding_id, d(2026, 8, 10), dec("40"), dec("600")).await;
    stamp_on(&pool, holding_id, d(2026, 8, 20), dec("0"), dec("0")).await;
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(d(2026, 7, 20), Decimal::from(40), Decimal::from(10)),
    )
    .await;
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::sell(d(2026, 8, 20), Decimal::from(40), Decimal::from(15)),
    )
    .await;

    testkit::backfill(&pool, conn_id).await?;
    drop(conn);

    let rows = backfill_digest(&pool, holding_id).await;

    // 08-01: `nxt` is 08-10 (per-unit 15), so 600; preferring `prv` would give 400.
    let (_, qty, value) = rows
        .iter()
        .find(|(day, _, _)| *day == d(2026, 8, 1))
        .expect("a derived day must exist between 07-20 and 08-10");
    assert_eq!(*qty, dec("40"));
    assert_eq!(
        *value,
        dec("600"),
        "must prefer the later (nxt) snapshot's per-unit value over the earlier (prv) one"
    );

    let (_, qty2, value2) = rows
        .iter()
        .find(|(day, _, _)| *day == d(2026, 8, 15))
        .expect("a derived day must exist between 08-10 and the sale");
    assert_eq!(
        *qty2,
        dec("40"),
        "the sell transaction reconstructs the pre-sale quantity"
    );
    assert_eq!(
        *value2,
        dec("600"),
        "falls back to the prv (08-10) per-unit value when nxt finds nothing"
    );
    Ok(())
}

/// A holding with no transactions is held flat; the suffix-sum join must not drop it for want of a `moves` row.
#[gripsou_core::testkit::db_test]
async fn a_holding_with_no_transactions_is_held_flat(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (_account_id, holding_id) =
        seed_cash(&pool, conn_id, &acct, dec("750"), d(2026, 8, 20)).await;

    testkit::backfill(&pool, conn_id).await?;

    assert_eq!(quantity_on(&pool, holding_id, d(2026, 8, 10)).await, None);
    assert_eq!(
        quantity_on(&pool, holding_id, d(2026, 8, 19)).await,
        Some(dec("750"))
    );
    Ok(())
}

/// The first and last day of the derived range both exist.
#[gripsou_core::testkit::db_test]
async fn covers_the_first_and_last_derived_day(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let (account_id, holding_id) =
        seed_cash(&pool, conn_id, &acct, dec("1000"), d(2026, 8, 20)).await;

    let mut conn = pool.acquire().await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn("acct-1", "first", "deposit", dec("50")).on(d(2026, 8, 10)),
    )
    .await?;
    testkit::backfill(&pool, conn_id).await?;
    drop(conn);

    let rows = backfill_digest(&pool, holding_id).await;
    assert!(!rows.is_empty(), "the derived range must not be empty");
    assert_eq!(rows.first().unwrap().0, d(2026, 8, 9));
    assert_eq!(rows.last().unwrap().0, d(2026, 8, 19));
    Ok(())
}
