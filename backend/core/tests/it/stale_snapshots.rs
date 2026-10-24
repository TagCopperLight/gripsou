//! While a provider can't reach the bank, its balances are not today's: the
//! ingest stamps no snapshot for today and leaves those days to the backfill
//! (#58).

use chrono::{Duration, NaiveDate};
use gripsou_core::dto::{CanonicalAccount, Freshness, SyncResult};
use gripsou_core::ingest::ingest;
use gripsou_core::testkit::{
    cash_holding, checking_account, equity_holding, seed_connection, stamp_on, txn_on,
};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

async fn today(pool: &PgPool, connection_id: Uuid) -> NaiveDate {
    sqlx::query_scalar("select user_today(user_id) from connection where id = $1")
        .bind(connection_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn account(as_of: Option<NaiveDate>, error: bool) -> CanonicalAccount {
    CanonicalAccount {
        freshness: Freshness { as_of, error },
        ..checking_account("acct-1")
    }
}

fn eur(n: i64) -> Decimal {
    Decimal::new(n, 0)
}

/// (day, quantity) of every snapshot, oldest first.
async fn snapshots(pool: &PgPool) -> Vec<(NaiveDate, Decimal)> {
    sqlx::query_as("select as_of, quantity from holding_snapshot order by as_of")
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn backfill_on(pool: &PgPool, day: NaiveDate) -> Option<Decimal> {
    sqlx::query_scalar("select quantity from holding_backfill where as_of = $1")
        .bind(day)
        .fetch_optional(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn an_account_not_refreshed_today_is_stamped_on_its_last_refresh(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let today = today(&pool, conn_id).await;
    let refreshed = today - Duration::days(3);
    let sync = SyncResult {
        accounts: vec![account(Some(refreshed), false)],
        holdings: vec![cash_holding("acct-1", eur(100))],
        ..Default::default()
    };
    let s = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s.accounts_stale, 1);
    assert_eq!(snapshots(&pool).await, vec![(refreshed, eur(100))]);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_refresh_date_after_today_is_taken_as_today(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let today = today(&pool, conn_id).await;
    let sync = SyncResult {
        accounts: vec![account(Some(today + Duration::days(1)), false)],
        holdings: vec![cash_holding("acct-1", eur(100))],
        ..Default::default()
    };
    let s = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s.accounts_stale, 0);
    assert_eq!(snapshots(&pool).await, vec![(today, eur(100))]);
    Ok(())
}

/// The whole story: broken for four days with the old daily snapshots still
/// there, then repaired. The broken days end up rebuilt from transactions.
#[sqlx::test(migrations = "../migrations")]
async fn a_broken_stretch_is_rebuilt_from_transactions_once_repaired(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let today = today(&pool, conn_id).await;
    let last_good = today - Duration::days(5);
    let spent = today - Duration::days(2);

    // The last good day, then the stale balances stamped every day since.
    let mut sync = SyncResult {
        accounts: vec![account(Some(last_good), false)],
        holdings: vec![cash_holding("acct-1", eur(100))],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;
    let holding: Uuid = sqlx::query_scalar("select id from holding")
        .fetch_one(&pool)
        .await?;
    for days_ago in 1..=4 {
        stamp_on(
            &pool,
            holding,
            today - Duration::days(days_ago),
            eur(100),
            eur(100),
        )
        .await;
    }

    // Broken: Powens reports an error and still returns the old balance.
    sync.accounts = vec![account(Some(last_good), true)];
    let s = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s.snapshots, 0, "no snapshot while in error");
    assert_eq!(s.snapshots_discarded, 4, "the stale days are dropped");
    assert_eq!(s.accounts_stale, 1);
    assert_eq!(snapshots(&pool).await, vec![(last_good, eur(100))]);

    // Repaired: today's balance, and the spending Powens catches up on.
    sync.accounts = vec![account(Some(today), false)];
    sync.holdings = vec![cash_holding("acct-1", eur(70))];
    sync.transactions = vec![txn_on("acct-1", "t1", "withdrawal", eur(-30), spent)];
    let s = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s.accounts_stale, 0);
    assert_eq!(
        snapshots(&pool).await,
        vec![(last_good, eur(100)), (today, eur(70))]
    );
    assert_eq!(
        backfill_on(&pool, spent - Duration::days(1)).await,
        Some(eur(100))
    );
    assert_eq!(backfill_on(&pool, spent).await, Some(eur(70)));
    assert_eq!(
        backfill_on(&pool, today - Duration::days(1)).await,
        Some(eur(70))
    );
    Ok(())
}

/// An error trumps the refresh date: even "refreshed today" stamps nothing,
/// and the snapshot an earlier, healthy sync took today is kept.
#[sqlx::test(migrations = "../migrations")]
async fn an_error_reported_today_keeps_the_earlier_snapshot(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let today = today(&pool, conn_id).await;
    let mut sync = SyncResult {
        accounts: vec![account(Some(today), false)],
        holdings: vec![cash_holding("acct-1", eur(100))],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;

    sync.accounts = vec![account(Some(today), true)];
    sync.holdings = vec![cash_holding("acct-1", eur(5))];
    let s = ingest(&pool, conn_id, &sync).await?;
    assert_eq!((s.snapshots, s.snapshots_discarded), (0, 0));
    assert_eq!(snapshots(&pool).await, vec![(today, eur(100))]);
    Ok(())
}

/// A holding with no snapshot at all would drop out of net worth, so one
/// first seen while in error is stamped once, on the last refresh.
#[sqlx::test(migrations = "../migrations")]
async fn a_holding_first_seen_in_error_is_stamped_once(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let today = today(&pool, conn_id).await;
    let refreshed = today - Duration::days(2);
    let sync = SyncResult {
        accounts: vec![account(Some(refreshed), true)],
        holdings: vec![cash_holding("acct-1", eur(100))],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;
    let s = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s.snapshots, 0, "only the first time");
    assert_eq!(snapshots(&pool).await, vec![(refreshed, eur(100))]);
    Ok(())
}

/// A provider that can't reach the bank may return fewer holdings: they are
/// not closed until the account is fresh again.
#[sqlx::test(migrations = "../migrations")]
async fn a_stale_account_does_not_close_missing_holdings(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let today = today(&pool, conn_id).await;
    let equity = || equity_holding("acct-1", "US0378331005", eur(3), eur(450), Some(eur(600)));
    let mut sync = SyncResult {
        accounts: vec![account(Some(today), false)],
        holdings: vec![cash_holding("acct-1", eur(100)), equity()],
        ..Default::default()
    };
    ingest(&pool, conn_id, &sync).await?;

    sync.holdings = vec![cash_holding("acct-1", eur(100))];
    for freshness in [
        account(Some(today), true),
        account(Some(today - Duration::days(1)), false),
    ] {
        sync.accounts = vec![freshness];
        let s = ingest(&pool, conn_id, &sync).await?;
        assert_eq!(s.holdings_closed, 0);
    }
    let qty: Decimal = sqlx::query_scalar(
        "select h.quantity from holding h \
         join instrument i on i.id = h.instrument_id where i.kind <> 'cash'",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(qty, eur(3), "the equity is still held");

    sync.accounts = vec![account(Some(today), false)];
    let s = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s.holdings_closed, 1, "closed once fresh");
    Ok(())
}
