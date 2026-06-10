//! Upsert a canonical account under a connection. On conflict, only
//! provider-derived fields are updated; user-editable `name`/`color` are
//! left untouched so a re-sync never clobbers a rename or recolor.

use uuid::Uuid;

use crate::dto::CanonicalAccount;
use crate::error::CoreError;

pub async fn upsert_account(
    conn: &mut sqlx::PgConnection,
    connection_id: Uuid,
    acct: &CanonicalAccount,
) -> Result<Uuid, CoreError> {
    let id = sqlx::query_scalar!(
        r#"
        insert into account (connection_id, name, currency, type_key, provider_meta, external_id)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (connection_id, external_id) where external_id is not null
        do update set
            currency = excluded.currency,
            type_key = excluded.type_key,
            provider_meta = excluded.provider_meta
        returning id
        "#,
        connection_id,
        acct.name,
        acct.currency,
        acct.type_key,
        acct.meta,
        acct.external_id,
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}
