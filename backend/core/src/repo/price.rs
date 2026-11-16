//! Idempotent on (instrument_id, ts): re-running overwrites the price.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

/// Prices and rates are dated in UTC (`fx_asof` and `unit_value_asof` cut days at UTC
/// midnight), whoever reads them.
pub fn market_today() -> chrono::NaiveDate {
    Utc::now().date_naive()
}

pub async fn has_fx_rate(db: impl sqlx::PgExecutor<'_>, currency: &str) -> Result<bool, CoreError> {
    Ok(sqlx::query_scalar!(
        r#"select fx_asof($1, $2) is not null as "ready!""#,
        currency,
        market_today(),
    )
    .fetch_one(db)
    .await?)
}

/// The points share one currency (they come from one listing).
pub async fn insert_prices(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
    points: &[(DateTime<Utc>, Decimal)],
    currency: &str,
) -> Result<u64, CoreError> {
    if points.is_empty() {
        return Ok(0);
    }
    let ts: Vec<DateTime<Utc>> = points.iter().map(|p| p.0).collect();
    let prices: Vec<Decimal> = points.iter().map(|p| p.1).collect();
    let res = sqlx::query!(
        r#"
        insert into price (instrument_id, ts, unit_price, currency)
        select $1, u.ts, u.unit_price, $4
        from unnest($2::timestamptz[], $3::numeric[]) as u(ts, unit_price)
        on conflict (instrument_id, ts)
        do update set unit_price = excluded.unit_price, currency = excluded.currency
        "#,
        instrument_id,
        &ts,
        &prices,
        currency,
    )
    .execute(&mut *conn)
    .await?;
    Ok(res.rows_affected())
}

/// Drives the refetch window's start and the same-day guard.
pub async fn latest_price_ts(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
) -> Result<Option<DateTime<Utc>>, CoreError> {
    let ts = sqlx::query_scalar!(
        r#"select max(ts) as "ts" from price where instrument_id = $1"#,
        instrument_id,
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(ts)
}
