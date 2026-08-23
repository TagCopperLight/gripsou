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
    stamp_snapshot(
        &mut conn,
        holding_id,
        day,
        Decimal::new(100, 0),
        Decimal::new(100, 0),
        Decimal::new(100, 0),
    )
    .await?;
    // Same day, new values -> overwrite, not a second row.
    stamp_snapshot(
        &mut conn,
        holding_id,
        day,
        Decimal::new(150, 0),
        Decimal::new(150, 0),
        Decimal::new(150, 0),
    )
    .await?;

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

#[sqlx::test(migrations = "../migrations")]
async fn stamping_a_snapshot_removes_the_backfill_row_for_that_day(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let instrument_id = resolve_instrument(
        &mut conn,
        &gripsou_core::dto::InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: "Euro".into(),
            currency: "EUR".into(),
        },
    )
    .await?;
    let holding_id = upsert_holding(
        &mut conn,
        account_id,
        instrument_id,
        &cash_holding("acct-1", Decimal::new(10000, 2)),
    )
    .await?;

    let day = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
    sqlx::query(
        "insert into holding_backfill (holding_id, as_of, quantity, value, cost_basis) \
         values ($1, $2, 1, 1, 1)",
    )
    .bind(holding_id)
    .bind(day)
    .execute(&pool)
    .await?;

    stamp_snapshot(
        &mut conn,
        holding_id,
        day,
        Decimal::new(20000, 2),
        Decimal::new(20000, 2),
        Decimal::new(20000, 2),
    )
    .await?;

    let backfilled: i64 = sqlx::query_scalar(
        "select count(*) from holding_backfill where holding_id = $1 and as_of = $2",
    )
    .bind(holding_id)
    .bind(day)
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        backfilled, 0,
        "stamping a snapshot must delete the backfill row for that day"
    );

    // And the union has exactly one row for the day.
    let points: i64 = sqlx::query_scalar(
        "select count(*) from holding_point where holding_id = $1 and as_of = $2",
    )
    .bind(holding_id)
    .bind(day)
    .fetch_one(&pool)
    .await?;
    assert_eq!(points, 1);
    Ok(())
}
