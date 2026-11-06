//! Holdings: the current position for an (account, instrument) pair.

use uuid::Uuid;

use crate::dto::CanonicalHolding;
use crate::error::CoreError;

pub async fn upsert_holding(
    conn: &mut sqlx::PgConnection,
    account_id: Uuid,
    instrument_id: Uuid,
    holding: &CanonicalHolding,
) -> Result<Uuid, CoreError> {
    let id = sqlx::query_scalar!(
        r#"
        insert into holding (account_id, instrument_id, quantity, cost_basis, updated_at)
        values ($1, $2, $3, $4, now())
        on conflict (account_id, instrument_id)
        do update set
            quantity = excluded.quantity,
            cost_basis = excluded.cost_basis,
            updated_at = now()
        returning id
        "#,
        account_id,
        instrument_id,
        holding.quantity,
        holding.cost_basis,
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Every holding under a connection (across all its accounts), as
/// `(holding id, account id)`. Used by the ingest to detect holdings that
/// vanished from the latest sync.
pub async fn ids_for_connection(
    conn: &mut sqlx::PgConnection,
    connection_id: Uuid,
) -> Result<Vec<(Uuid, Uuid)>, CoreError> {
    let ids = sqlx::query!(
        r#"
        select h.id, h.account_id
        from holding h
        join account a on a.id = h.account_id
        where a.connection_id = $1
        "#,
        connection_id,
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok(ids.into_iter().map(|r| (r.id, r.account_id)).collect())
}

/// Zero a holding's current position (quantity and cost basis). Called when a
/// holding disappears from a sync so it stops contributing to current
/// valuations; the row and its historical snapshots are preserved.
pub async fn zero_holding(
    conn: &mut sqlx::PgConnection,
    holding_id: Uuid,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"update holding set quantity = 0, cost_basis = 0, updated_at = now() where id = $1"#,
        holding_id,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// A holding the caller owns.
pub struct OwnedHolding {
    pub id: Uuid,
    pub account_id: Uuid,
    pub account_currency: String,
}

/// The holding, if `user_id` owns it; otherwise `CoreError::NotFound`.
pub async fn owned_holding(
    conn: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
    holding_id: Uuid,
) -> Result<OwnedHolding, CoreError> {
    sqlx::query_as!(
        OwnedHolding,
        r#"
        select h.id as "id!", h.account_id as "account_id!", a.currency as "account_currency!"
        from holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1 and c.user_id = $2
        "#,
        holding_id,
        user_id,
    )
    .fetch_optional(conn)
    .await?
    .ok_or(CoreError::NotFound("unknown holding"))
}
