mod common;

use chrono::NaiveDate;
use common::{cash_holding, checking_account, equity_holding, holding_ids, insert_price_on, seed_connection, stamp_on};
use gripsou_core::dto::SyncResult;
use gripsou_core::ingest::ingest;
use gripsou_core::repo::query;
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

#[sqlx::test(migrations = "../migrations")]
async fn net_worth_series_groups_by_day(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(&pool, conn_id, &SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![
            cash_holding("acct-1", Decimal::new(100, 0)),
            equity_holding("acct-1", "US0378331005", Decimal::new(3, 0), Decimal::new(450, 0), Some(Decimal::new(600, 0))),
        ],
        transactions: vec![],
    }).await?;

    let ids = holding_ids(&pool).await; // [Apple, Euro] by instrument name
    let (d1, d2) = (NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(), NaiveDate::from_ymd_opt(2026, 1, 2).unwrap());
    // Day 1: apple value 600, cash 100 -> nw 700, invested 450+100
    stamp_on(&pool, ids[0], d1, Decimal::new(3, 0), Decimal::new(600, 0), Decimal::new(450, 0)).await;
    stamp_on(&pool, ids[1], d1, Decimal::new(100, 0), Decimal::new(100, 0), Decimal::new(100, 0)).await;
    // Day 2: apple value 630
    stamp_on(&pool, ids[0], d2, Decimal::new(3, 0), Decimal::new(630, 0), Decimal::new(450, 0)).await;
    stamp_on(&pool, ids[1], d2, Decimal::new(100, 0), Decimal::new(100, 0), Decimal::new(100, 0)).await;

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection").fetch_one(&pool).await?;
    let rows = query::net_worth_series(&pool, user_id, d1, d2).await?;

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].as_of, d1);
    assert_eq!(rows[0].net_worth, Decimal::new(700, 0));
    assert_eq!(rows[0].invested, Decimal::new(550, 0));
    assert_eq!(rows[1].net_worth, Decimal::new(730, 0));
    Ok(())
}
