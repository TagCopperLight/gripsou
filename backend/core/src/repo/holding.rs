//! Upsert a holding (current position) for an (account, instrument) pair.

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
