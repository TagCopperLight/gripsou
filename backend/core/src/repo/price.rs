//! Insert/upsert a single price point for a (global) instrument.
//! Idempotent on (instrument_id, ts): re-running overwrites the price.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

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
