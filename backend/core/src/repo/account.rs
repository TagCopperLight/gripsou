//! Accounts: the sync's upsert, the user's edits, and the account-type keys.
//!
//! An upsert conflict updates only provider-derived fields, so a re-sync never clobbers a rename, recolor
//! or chosen account type.

use std::sync::OnceLock;

use uuid::Uuid;

use crate::dto::{CanonicalAccount, SyncHealth};
use crate::error::CoreError;

/// Shared with the frontend (`shared/account-palette.json`).
fn account_palette() -> &'static [String] {
    static PALETTE: OnceLock<Vec<String>> = OnceLock::new();
    PALETTE.get_or_init(|| {
        serde_json::from_str(include_str!("../../../../shared/account-palette.json"))
            .expect("shared/account-palette.json must be a JSON array of strings")
    })
}

pub async fn upsert_account(
    conn: &mut sqlx::PgConnection,
    connection_id: Uuid,
    acct: &CanonicalAccount,
) -> Result<Uuid, CoreError> {
    let meta = match &acct.health {
        Some(h) => SyncHealth::into_meta(Some(h), acct.meta.clone()),
        None => acct.meta.clone(),
    };
    let id = sqlx::query_scalar!(
        r#"
        insert into account (connection_id, name, currency, type_key, provider_meta, external_id, color)
        values ($1, $2, $3, $4, $5, $6,
            ($7::text[])[1 + floor(random() * array_length($7::text[], 1))::int])
        on conflict (connection_id, external_id) where external_id is not null
        do update set
            currency = excluded.currency,
            provider_meta = excluded.provider_meta
        returning id
        "#,
        connection_id,
        acct.name,
        acct.currency,
        acct.type_key,
        meta,
        acct.external_id,
        account_palette(),
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

pub struct UpdatedAccount {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub type_key: String,
}

/// Scoped by `user_id` via connection. Returns `None` when no account matches the pair or `type_key` is
/// unknown.
pub async fn update_account(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    account_id: Uuid,
    name: &str,
    type_key: &str,
    color: &str,
) -> Result<Option<UpdatedAccount>, CoreError> {
    let row = sqlx::query_as!(
        UpdatedAccount,
        r#"
        update account a
           set name = $3, type_key = $4, color = $5
          from connection c, account_type t
         where a.id = $1 and a.connection_id = c.id and c.user_id = $2
           and t.key = $4
        returning a.id      as "id!",
                  a.name    as "name!",
                  a.color,
                  a.type_key as "type_key!"
        "#,
        account_id,
        user_id,
        name,
        type_key,
        color,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn type_keys(pool: &sqlx::PgPool) -> Result<Vec<String>, CoreError> {
    let keys = sqlx::query_scalar!("select key from account_type order by key")
        .fetch_all(pool)
        .await?;
    Ok(keys)
}
