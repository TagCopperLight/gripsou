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

/// Insert a user-entered lot. `external_id` is null — that is what keeps it out
/// of the provider dedup index (§9.2), and also means there is no dedup for it:
/// the caller must never resubmit a row it has already written.
///
/// `amount` is passed in rather than derived here because its SIGN depends on
/// the type — a buy is cash out, a sale is cash in — and the handler has
/// already computed and bounds-checked the product.
#[allow(clippy::too_many_arguments)]
pub async fn insert_manual_lot(
    conn: &mut sqlx::PgConnection,
    holding_id: Uuid,
    user_id: Uuid,
    ts: chrono::DateTime<chrono::Utc>,
    kind: &str,
    quantity: rust_decimal::Decimal,
    unit_price: rust_decimal::Decimal,
    amount: rust_decimal::Decimal,
) -> Result<Option<Uuid>, CoreError> {
    let id = sqlx::query_scalar!(
        r#"
        insert into transaction
            (account_id, instrument_id, ts, type, quantity, unit_price, amount, external_id)
        select h.account_id, h.instrument_id, $2, $3, $4, $5, $6, null
        from holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1 and c.user_id = $7
        returning id
        "#,
        holding_id,
        ts,
        kind,
        quantity,
        unit_price,
        amount,
        user_id,
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(id)
}

/// Delete user-entered lots by id, returning how many actually went. The
/// predicate is the whole security model of the delete path: a row must belong
/// to THIS holding's (account, instrument), be user-entered (`external_id is
/// null`), be a buy or a sell, and sit under a connection owned by `user_id`.
/// The caller compares the returned count against the ids it asked for — any
/// shortfall means one of those held, and the batch is rejected wholesale.
pub async fn delete_manual_lots(
    conn: &mut sqlx::PgConnection,
    holding_id: Uuid,
    user_id: Uuid,
    ids: &[Uuid],
) -> Result<u64, CoreError> {
    let deleted = sqlx::query!(
        r#"
        delete from transaction t
        using holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1
          and c.user_id = $2
          and t.account_id = h.account_id
          and t.instrument_id = h.instrument_id
          and t.external_id is null
          and t.type in ('buy', 'sell')
          and t.id = any($3)
        "#,
        holding_id,
        user_id,
        ids,
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(deleted)
}
