//! Insert a transaction, deduplicated on (account_id, external_id).
//! Transactions are immutable history: on conflict we skip, never update.
//! `instrument_id` is left null for now — the canonical transaction DTO
//! carries no instrument reference yet (only affects the deferred buy/sell
//! "capital invested" staircase).

use uuid::Uuid;

use crate::dto::CanonicalTransaction;
use crate::error::CoreError;

/// Returns `true` if a new row was inserted, `false` if it was a duplicate.
pub async fn insert_transaction(
    conn: &mut sqlx::PgConnection,
    account_id: Uuid,
    txn: &CanonicalTransaction,
) -> Result<bool, CoreError> {
    let inserted = sqlx::query_scalar!(
        r#"
        insert into transaction
            (account_id, instrument_id, ts, type, quantity, unit_price, amount, fee, external_id)
        values ($1, null, $2, $3, $4, $5, $6, $7, $8)
        on conflict (account_id, external_id) where external_id is not null
        do nothing
        returning id
        "#,
        account_id,
        txn.ts,
        txn.kind,
        txn.quantity,
        txn.unit_price,
        txn.amount,
        txn.fee,
        txn.external_id,
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(inserted.is_some())
}
