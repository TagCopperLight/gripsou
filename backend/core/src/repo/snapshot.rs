//! Stamp a per-holding snapshot for a given day. Idempotent on
//! (holding_id, as_of): re-syncing the same day overwrites it. The caller
//! computes `value` (cash = quantity; security = provider valuation or 0).
//! Stamping also deletes any derived `holding_backfill` row for the same day —
//! synced truth always wins, and the `holding_point` union depends on it.

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

    // Invariant: a day with a snapshot never also carries a
    // derived row, so `holding_point` (the union of the two) stays unambiguous.
    sqlx::query!(
        "delete from holding_backfill where holding_id = $1 and as_of = $2",
        holding_id,
        as_of,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Delete an account's snapshots dated after `day`. Its provider hasn't
/// reached the institution since, so they were stamped from stale balances;
/// the backfill rebuilds those days from transactions instead. Their derived
/// rows need no cleanup: the ingest rebuilds the connection's whole backfill.
pub async fn delete_snapshots_after(
    conn: &mut sqlx::PgConnection,
    account_id: Uuid,
    day: NaiveDate,
) -> Result<u64, CoreError> {
    let deleted = sqlx::query!(
        r#"
        delete from holding_snapshot hs
        using holding h
        where hs.holding_id = h.id and h.account_id = $1 and hs.as_of > $2
        "#,
        account_id,
        day,
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(deleted)
}

/// Whether a holding has at least one snapshot.
pub async fn has_snapshot(
    conn: &mut sqlx::PgConnection,
    holding_id: Uuid,
) -> Result<bool, CoreError> {
    let found = sqlx::query_scalar!(
        r#"select exists (select 1 from holding_snapshot where holding_id = $1) as "found!""#,
        holding_id,
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(found)
}
