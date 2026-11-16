//! Stamping deletes any derived `holding_backfill` row for the same day: synced truth wins.

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
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        insert into holding_snapshot (holding_id, as_of, quantity, value)
        values ($1, $2, $3, $4)
        on conflict (holding_id, as_of)
        do update set
            quantity = excluded.quantity,
            value = excluded.value
        "#,
        holding_id,
        as_of,
        quantity,
        value,
    )
    .execute(&mut *conn)
    .await?;

    sqlx::query!(
        "delete from holding_backfill where holding_id = $1 and as_of = $2",
        holding_id,
        as_of,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}
