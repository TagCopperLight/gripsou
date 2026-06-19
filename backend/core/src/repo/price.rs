//! Insert/upsert price points for a (global) instrument.
//! Idempotent on (instrument_id, ts): re-running overwrites the price.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

/// Upsert many price points for one instrument in a single statement. The points
/// share a currency (the caller filters to the instrument's currency first).
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

pub async fn insert_price(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
    ts: DateTime<Utc>,
    unit_price: Decimal,
    currency: &str,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        insert into price (instrument_id, ts, unit_price, currency)
        values ($1, $2, $3, $4)
        on conflict (instrument_id, ts)
        do update set unit_price = excluded.unit_price, currency = excluded.currency
        "#,
        instrument_id,
        ts,
        unit_price,
        currency,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The most recent price timestamp for an instrument, or `None` if it has no
/// prices yet. Drives the incremental-fetch `since` and the same-day guard.
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
