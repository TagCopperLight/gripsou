//! Upsert a transaction, deduplicated on (account_id, external_id).
//! Not append-only: Powens corrects rows after the fact, so the provider wins
//! on the fields it owns.

use uuid::Uuid;

use crate::dto::CanonicalTransaction;
use crate::error::CoreError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TxnWrite {
    Inserted,
    Updated,
}

pub async fn upsert_transaction(
    conn: &mut sqlx::PgConnection,
    account_id: Uuid,
    txn: &CanonicalTransaction,
) -> Result<TxnWrite, CoreError> {
    // `xmax = 0` is true only for a freshly inserted tuple, so one round trip
    // distinguishes an insert from an update.
    let inserted = sqlx::query_scalar!(
        r#"
        insert into transaction
            (account_id, spent_on, type, amount,
             description, external_id, provider_meta, booked_on)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (account_id, external_id) where external_id is not null
        do update set
            spent_on      = excluded.spent_on,
            type          = excluded.type,
            amount        = excluded.amount,
            description   = excluded.description,
            booked_on     = excluded.booked_on,
            provider_meta = excluded.provider_meta
        returning (xmax = 0) as "inserted!"
        "#,
        account_id,
        txn.spent_on,
        txn.kind,
        txn.amount,
        txn.description,
        txn.external_id,
        txn.provider_meta,
        txn.booked_on,
    )
    .fetch_one(&mut *conn)
    .await?;

    Ok(if inserted {
        TxnWrite::Inserted
    } else {
        TxnWrite::Updated
    })
}
