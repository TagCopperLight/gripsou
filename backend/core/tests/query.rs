mod common;

use common::{cash_holding, checking_account, insert_price_on, seed_connection};
use gripsou_core::dto::SyncResult;
use gripsou_core::ingest::ingest;
use rust_decimal::Decimal;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn insert_price_is_upsert(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(&pool, conn_id, &SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
        transactions: vec![],
    }).await?;

    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'cash'").fetch_one(&pool).await?;
    let ts = chrono::Utc::now();

    insert_price_on(&pool, instrument_id, ts, Decimal::new(1, 0)).await;
    insert_price_on(&pool, instrument_id, ts, Decimal::new(2, 0)).await; // same ts → upsert

    let count: i64 = sqlx::query_scalar("select count(*) from price").fetch_one(&pool).await?;
    assert_eq!(count, 1, "same (instrument, ts) upserts rather than duplicating");
    let price: Decimal = sqlx::query_scalar("select unit_price from price").fetch_one(&pool).await?;
    assert_eq!(price, Decimal::new(2, 0));
    Ok(())
}
