mod common;

use chrono::NaiveDate;
use common::seed_connection;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

/// Insert a cash instrument for a currency and return its id.
async fn cash_instrument(pool: &PgPool, currency: &str) -> Uuid {
    sqlx::query_scalar(
        "insert into instrument (kind, name, currency) values ('cash', $1, $1) returning id",
    )
    .bind(currency)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn day(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn base_currency_defaults_to_eur(pool: PgPool) -> anyhow::Result<()> {
    let pivot = gripsou_core::repo::settings::base_currency(&pool).await?;
    assert_eq!(pivot, "EUR");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn fx_asof_is_one_for_the_pivot(pool: PgPool) -> anyhow::Result<()> {
    let rate: Option<Decimal> = sqlx::query_scalar("select fx_asof('EUR', $1)")
        .bind(day(2026, 8, 14))
        .fetch_one(&pool)
        .await?;
    assert_eq!(rate, Some(Decimal::ONE));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn fx_asof_is_null_when_no_rate_is_known(pool: PgPool) -> anyhow::Result<()> {
    cash_instrument(&pool, "CNY").await;
    let rate: Option<Decimal> = sqlx::query_scalar("select fx_asof('CNY', $1)")
        .bind(day(2026, 8, 14))
        .fetch_one(&pool)
        .await?;
    assert_eq!(rate, None, "a missing rate must be NULL, never 1");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn fx_asof_takes_the_latest_rate_on_or_before_the_day(pool: PgPool) -> anyhow::Result<()> {
    let cny = cash_instrument(&pool, "CNY").await;
    let mut conn = pool.acquire().await?;
    for (d, rate) in [("2026-08-10", "0.10"), ("2026-08-12", "0.12")] {
        gripsou_core::repo::price::insert_price(
            &mut conn,
            cny,
            format!("{d}T00:00:00Z").parse()?,
            rate.parse()?,
            "EUR",
        )
        .await?;
    }

    let on_11: Option<Decimal> = sqlx::query_scalar("select fx_asof('CNY', $1)")
        .bind(day(2026, 8, 11))
        .fetch_one(&pool)
        .await?;
    let on_13: Option<Decimal> = sqlx::query_scalar("select fx_asof('CNY', $1)")
        .bind(day(2026, 8, 13))
        .fetch_one(&pool)
        .await?;
    let on_09: Option<Decimal> = sqlx::query_scalar("select fx_asof('CNY', $1)")
        .bind(day(2026, 8, 9))
        .fetch_one(&pool)
        .await?;

    assert_eq!(on_11, Some("0.10".parse()?));
    assert_eq!(on_13, Some("0.12".parse()?));
    assert_eq!(on_09, None, "before the series starts there is no rate");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn unit_value_asof_of_cash_is_the_fx_rate(pool: PgPool) -> anyhow::Result<()> {
    let cny = cash_instrument(&pool, "CNY").await;
    let mut conn = pool.acquire().await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        cny,
        "2026-08-12T00:00:00Z".parse()?,
        "0.12".parse()?,
        "EUR",
    )
    .await?;

    let v: Option<Decimal> = sqlx::query_scalar("select unit_value_asof($1, $2)")
        .bind(cny)
        .bind(day(2026, 8, 14))
        .fetch_one(&pool)
        .await?;
    assert_eq!(v, Some("0.12".parse()?));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn unit_value_asof_converts_using_the_price_rows_own_currency(
    pool: PgPool,
) -> anyhow::Result<()> {
    // The instrument claims EUR (as Powens sometimes does) but Yahoo quotes it
    // in USD. The price row's currency must win.
    let usd = cash_instrument(&pool, "USD").await;
    let equity: Uuid = sqlx::query_scalar(
        "insert into instrument (kind, symbol, name, currency) \
         values ('equity', 'AAPL', 'Apple Inc.', 'EUR') returning id",
    )
    .fetch_one(&pool)
    .await?;

    let mut conn = pool.acquire().await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        usd,
        "2026-08-12T00:00:00Z".parse()?,
        "0.90".parse()?,
        "EUR",
    )
    .await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        equity,
        "2026-08-12T00:00:00Z".parse()?,
        "200".parse()?,
        "USD",
    )
    .await?;

    let v: Option<Decimal> = sqlx::query_scalar("select unit_value_asof($1, $2)")
        .bind(equity)
        .bind(day(2026, 8, 14))
        .fetch_one(&pool)
        .await?;
    assert_eq!(v, Some("180.00".parse()?), "200 USD * 0.90 = 180 EUR");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn unit_value_asof_is_null_when_the_rate_is_missing(pool: PgPool) -> anyhow::Result<()> {
    let equity: Uuid = sqlx::query_scalar(
        "insert into instrument (kind, symbol, name, currency) \
         values ('equity', 'AAPL', 'Apple Inc.', 'USD') returning id",
    )
    .fetch_one(&pool)
    .await?;
    let mut conn = pool.acquire().await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        equity,
        "2026-08-12T00:00:00Z".parse()?,
        "200".parse()?,
        "USD",
    )
    .await?;

    let v: Option<Decimal> = sqlx::query_scalar("select unit_value_asof($1, $2)")
        .bind(equity)
        .bind(day(2026, 8, 14))
        .fetch_one(&pool)
        .await?;
    assert_eq!(v, None, "a price we cannot convert is not a value");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn reporting_fx_asof_reads_the_users_currency_and_falls_back_to_one(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;

    // No prefs.currency yet → defaults to EUR → divisor 1.
    let d: Option<Decimal> = sqlx::query_scalar("select reporting_fx_asof($1, $2)")
        .bind(user_id)
        .bind(day(2026, 8, 14))
        .fetch_one(&pool)
        .await?;
    assert_eq!(d, Some(Decimal::ONE));

    // Reporting in USD with a known rate → that rate.
    let usd = cash_instrument(&pool, "USD").await;
    let mut conn = pool.acquire().await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        usd,
        "2026-08-12T00:00:00Z".parse()?,
        "0.90".parse()?,
        "EUR",
    )
    .await?;
    sqlx::query("update users set prefs = jsonb_set(prefs, '{currency}', '\"USD\"') where id = $1")
        .bind(user_id)
        .execute(&pool)
        .await?;
    let d: Option<Decimal> = sqlx::query_scalar("select reporting_fx_asof($1, $2)")
        .bind(user_id)
        .bind(day(2026, 8, 14))
        .fetch_one(&pool)
        .await?;
    assert_eq!(d, Some("0.90".parse()?));

    // Reporting in a currency with no rate → 1, i.e. report in the pivot.
    sqlx::query("update users set prefs = jsonb_set(prefs, '{currency}', '\"CNY\"') where id = $1")
        .bind(user_id)
        .execute(&pool)
        .await?;
    let d: Option<Decimal> = sqlx::query_scalar("select reporting_fx_asof($1, $2)")
        .bind(user_id)
        .bind(day(2026, 8, 14))
        .fetch_one(&pool)
        .await?;
    assert_eq!(d, Some(Decimal::ONE));
    Ok(())
}
