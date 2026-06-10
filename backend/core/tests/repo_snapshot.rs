mod common;

use chrono::NaiveDate;
use common::{cash_holding, checking_account, seed_connection};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::holding::upsert_holding;
use gripsou_core::repo::instrument::resolve_instrument;
use gripsou_core::repo::snapshot::stamp_snapshot;
use rust_decimal::Decimal;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn stamps_and_overwrites_same_day(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let h = cash_holding("acct-1", Decimal::new(100, 0));

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    let instrument_id = resolve_instrument(&mut conn, &h.instrument).await?;
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &h).await?;

    let day = NaiveDate::from_ymd_opt(2026, 6, 10).unwrap();
    stamp_snapshot(&mut conn, holding_id, day, Decimal::new(100, 0), Decimal::new(100, 0), Decimal::new(100, 0)).await?;
    // Same day, new values -> overwrite, not a second row.
    stamp_snapshot(&mut conn, holding_id, day, Decimal::new(150, 0), Decimal::new(150, 0), Decimal::new(150, 0)).await?;

    let count: i64 = sqlx::query_scalar(
        "select count(*) from holding_snapshot where holding_id = $1 and as_of = $2",
    )
    .bind(holding_id)
    .bind(day)
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 1, "one snapshot per (holding, day)");

    let value: Decimal = sqlx::query_scalar(
        "select value from holding_snapshot where holding_id = $1 and as_of = $2",
    )
    .bind(holding_id)
    .bind(day)
    .fetch_one(&pool)
    .await?;
    assert_eq!(value, Decimal::new(150, 0), "re-stamp overwrites the day");
    Ok(())
}
