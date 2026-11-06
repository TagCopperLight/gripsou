//! Insert/upsert price points for a (global) instrument.
//! Idempotent on (instrument_id, ts): re-running overwrites the price.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

/// The current day for market data. Prices and rates are dated in UTC
/// (`fx_asof` and `unit_value_asof` cut their days at UTC midnight), whoever
/// reads them. A user's own day is [`crate::repo::prefs::today`].
pub fn market_today() -> chrono::NaiveDate {
    Utc::now().date_naive()
}

/// Whether figures in `currency` can be read today: it is the pivot, or a
/// rate into it is stored (`fx_asof`).
pub async fn has_fx_rate(db: impl sqlx::PgExecutor<'_>, currency: &str) -> Result<bool, CoreError> {
    Ok(sqlx::query_scalar!(
        r#"select fx_asof($1, $2) is not null as "ready!""#,
        currency,
        market_today(),
    )
    .fetch_one(db)
    .await?)
}

/// Upsert many price points for one instrument in a single statement. The points
/// share a currency (they come from one listing, hence one currency).
/// Returns the number of rows written. Idempotent on (instrument_id, ts).
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

/// The most recent price timestamp for an instrument, or `None` if it has no
/// prices yet. Drives the refetch window's start and the same-day guard.
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
