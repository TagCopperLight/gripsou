//! Stamp a per-holding snapshot for a given day. Idempotent on
//! (holding_id, as_of): re-syncing the same day overwrites it. The caller
//! computes `value` (cash = quantity; security = provider valuation or 0).

use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

pub async fn stamp_snapshot(
    conn: &mut sqlx::PgConnection,
    holding_id: Uuid,
    as_of: NaiveDate,
    quantity: Decimal,
    value: Decimal,
    cost_basis: Decimal,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        insert into holding_snapshot (holding_id, as_of, quantity, value, cost_basis)
        values ($1, $2, $3, $4, $5)
        on conflict (holding_id, as_of)
        do update set
            quantity = excluded.quantity,
            value = excluded.value,
            cost_basis = excluded.cost_basis
        "#,
        holding_id,
        as_of,
        quantity,
        value,
        cost_basis,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}
