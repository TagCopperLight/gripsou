//! Upsert a canonical account under a connection. On conflict, only
//! provider-derived fields are updated; user-editable `name`/`color`/
//! `type_key` are left untouched so a re-sync never clobbers a rename,
//! recolor, or a user's chosen account type.

use std::sync::OnceLock;

use uuid::Uuid;

use crate::dto::CanonicalAccount;
use crate::error::CoreError;

/// Single source of truth shared with the frontend (`shared/account-palette.json`).
/// Used to assign a random color to a freshly imported account.
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
        acct.meta,
        acct.external_id,
        account_palette(),
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// User-editable fields returned after an edit-account save. `color` is
/// nullable in the schema, so it stays `Option`.
pub struct UpdatedAccount {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub type_key: String,
    pub type_label: String,
}

/// Update the user-editable fields of one account, scoped by `user_id` (via
/// connection) so a user can only edit their own accounts. Returns `None` when
/// the `(account_id, user_id)` pair matches no account (wrong owner / unknown
/// id) or `type_key` is not a known account type — the join then yields no row.
///
/// Takes the pool (not a `&mut PgConnection` like the ingest helpers): this is a
/// standalone, interactive mutation from the API, never part of a sync
/// transaction.
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
                  a.type_key as "type_key!",
                  t.label    as "type_label!"
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
