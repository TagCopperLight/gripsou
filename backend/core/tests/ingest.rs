mod common;

use common::{cash_holding, checking_account, deposit_txn, equity_holding, seed_connection};
use gripsou_core::dto::SyncResult;
use gripsou_core::error::CoreError;
use gripsou_core::ingest::ingest;
use rust_decimal::Decimal;
use sqlx::PgPool;

fn sample_sync() -> SyncResult {
    SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![
            cash_holding("acct-1", Decimal::new(100, 0)),
            equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            ),
        ],
        transactions: vec![deposit_txn("acct-1", "txn-1", Decimal::new(100, 0))],
    }
}

#[sqlx::test(migrations = "../migrations")]
async fn ingest_then_reingest_is_idempotent(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = sample_sync();

    let s1 = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s1.accounts, 1);
    assert_eq!(s1.holdings, 2);
    assert_eq!(s1.transactions_inserted, 1);
    assert_eq!(s1.snapshots, 2);

    let s2 = ingest(&pool, conn_id, &sync).await?;
    assert_eq!(s2.transactions_inserted, 0, "duplicate txn not re-inserted");

    let accounts: i64 = sqlx::query_scalar("select count(*) from account")
        .fetch_one(&pool)
        .await?;
    let holdings: i64 = sqlx::query_scalar("select count(*) from holding")
        .fetch_one(&pool)
        .await?;
    let txns: i64 = sqlx::query_scalar("select count(*) from transaction")
        .fetch_one(&pool)
        .await?;
    let snaps: i64 = sqlx::query_scalar("select count(*) from holding_snapshot")
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        (accounts, holdings, txns, snaps),
        (1, 2, 1, 2),
        "no duplicates after re-ingest"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn cash_instrument_is_shared_across_accounts(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1"), checking_account("acct-2")],
        holdings: vec![
            cash_holding("acct-1", Decimal::new(100, 0)),
            cash_holding("acct-2", Decimal::new(200, 0)),
        ],
        transactions: vec![],
    };
    ingest(&pool, conn_id, &sync).await?;

    let cash_instruments: i64 =
        sqlx::query_scalar("select count(*) from instrument where kind = 'cash'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        cash_instruments, 1,
        "one EUR cash instrument shared by both accounts"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn snapshot_value_matrix(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![
            cash_holding("acct-1", Decimal::new(100, 0)), // cash -> value = qty = 100
            equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            ), // valued -> 600
            equity_holding(
                "acct-1",
                "US5949181045",
                Decimal::new(2, 0),
                Decimal::new(300, 0),
                None,
            ), // unpriced -> 0
        ],
        transactions: vec![],
    };
    ingest(&pool, conn_id, &sync).await?;

    let values: Vec<Decimal> =
        sqlx::query_scalar("select value from holding_snapshot order by value")
            .fetch_all(&pool)
            .await?;
    assert_eq!(
        values,
        vec![
            Decimal::new(0, 0),
            Decimal::new(100, 0),
            Decimal::new(600, 0)
        ]
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn unknown_account_ref_errors_and_rolls_back(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![cash_holding("ghost", Decimal::new(100, 0))], // references missing account
        transactions: vec![],
    };
    let err = ingest(&pool, conn_id, &sync).await.unwrap_err();
    assert!(matches!(err, CoreError::UnknownAccountRef { .. }));

    // Atomicity: the account that *was* valid must not have been committed.
    let accounts: i64 = sqlx::query_scalar("select count(*) from account")
        .fetch_one(&pool)
        .await?;
    assert_eq!(accounts, 0, "failed ingest rolls back entirely");
    Ok(())
}
