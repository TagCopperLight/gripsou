//! Upsert a transaction, deduplicated on (account_id, external_id).
//! Not append-only: Powens corrects rows after the fact, so the provider wins
//! on the fields it owns. The `coalesce`d columns are the ones a user can fill
//! in (§7) — a plain assignment there would erase them on the next sync.

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
            (account_id, instrument_id, ts, type, quantity, unit_price, amount, fee,
             description, external_id, provider_meta, booked_on)
        values ($1, null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (account_id, external_id) where external_id is not null
        do update set
            ts            = excluded.ts,
            type          = excluded.type,
            amount        = excluded.amount,
            fee           = excluded.fee,
            description   = excluded.description,
            booked_on     = excluded.booked_on,
            provider_meta = excluded.provider_meta,
            -- User enrichment: Powens always sends null here (§2.1), and a plain
            -- assignment would wipe an instrument the user identified.
            instrument_id = coalesce(excluded.instrument_id, transaction.instrument_id),
            quantity      = coalesce(excluded.quantity,      transaction.quantity),
            unit_price    = coalesce(excluded.unit_price,    transaction.unit_price)
        returning (xmax = 0) as "inserted!"
        "#,
        account_id,
        txn.ts,
        txn.kind,
        txn.quantity,
        txn.unit_price,
        txn.amount,
        txn.fee,
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

/// Record a user-entered purchase against a holding (§9.2).
///
/// `external_id` stays null: that is what marks the row user-entered, keeps it
/// out of the provider dedup index, and therefore out of reach of every
/// provider upsert. `amount` is the real cash impact, not a token value, so the
/// Transactions page and Phase 2 budgeting both see the truth. No "manual" flag
/// exists anywhere — a lot is a `buy`, and the cash walk already excludes
/// `buy` on a PEA (§8.1).
///
/// Ownership is enforced in this query itself (`holding -> account ->
/// connection`, `connection.user_id = $5`) rather than trusted from a caller's
/// prior check: a public core API must not rely on every future caller
/// re-deriving the same predicate. Returns `None` — not an error — when the
/// holding doesn't exist or isn't owned by `user_id`, so callers can map that
/// to 404 instead of a decode failure on an empty row.
pub async fn insert_manual_lot(
    conn: &mut sqlx::PgConnection,
    holding_id: Uuid,
    user_id: Uuid,
    ts: chrono::DateTime<chrono::Utc>,
    quantity: rust_decimal::Decimal,
    unit_price: rust_decimal::Decimal,
) -> Result<Option<Uuid>, CoreError> {
    let id = sqlx::query_scalar!(
        r#"
        insert into transaction
            (account_id, instrument_id, ts, type, quantity, unit_price, amount, external_id)
        select h.account_id, h.instrument_id, $2, 'buy', $3, $4,
               -($3::numeric * $4::numeric), null
        from holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1 and c.user_id = $5
        returning id
        "#,
        holding_id,
        ts,
        quantity,
        unit_price,
        user_id,
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(id)
}
