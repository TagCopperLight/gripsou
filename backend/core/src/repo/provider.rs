//! Provider catalog reads for the Server settings page. The toggle state is
//! membership in `app_settings.enabled_providers`; the catalog row supplies
//! the display name and description. Global (not user-scoped).

use crate::error::CoreError;

pub struct ProviderRow {
    pub key: String,
    pub display_name: String,
    pub description: Option<String>,
    pub enabled: bool,
}

/// Available account providers (kind='account', provider.enabled), each with
/// `enabled` derived from membership in app_settings.enabled_providers.
pub async fn account_providers(pool: &sqlx::PgPool) -> Result<Vec<ProviderRow>, CoreError> {
    let rows = sqlx::query_as!(
        ProviderRow,
        r#"
        select p.key                              as "key!",
               p.display_name                     as "display_name!",
               p.description                      as "description",
               (p.key = any(s.enabled_providers)) as "enabled!"
        from provider p
        cross join app_settings s
        where s.id = 1 and p.kind = 'account' and p.enabled = true
        order by p.display_name
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A single available account provider by key, or None if it does not exist
/// (or is not an available account provider).
pub async fn account_provider(
    pool: &sqlx::PgPool,
    key: &str,
) -> Result<Option<ProviderRow>, CoreError> {
    let row = sqlx::query_as!(
        ProviderRow,
        r#"
        select p.key                              as "key!",
               p.display_name                     as "display_name!",
               p.description                      as "description",
               (p.key = any(s.enabled_providers)) as "enabled!"
        from provider p
        cross join app_settings s
        where s.id = 1 and p.kind = 'account' and p.enabled = true and p.key = $1
        "#,
        key,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Add or remove `key` from app_settings.enabled_providers. Idempotent: adding
/// an already-present key (or removing an absent one) is a no-op.
pub async fn set_enabled(
    pool: &sqlx::PgPool,
    key: &str,
    enabled: bool,
) -> Result<(), CoreError> {
    if enabled {
        sqlx::query!(
            r#"
            update app_settings
            set enabled_providers = case
                when $1 = any(enabled_providers) then enabled_providers
                else array_append(enabled_providers, $1)
            end
            where id = 1
            "#,
            key,
        )
        .execute(pool)
        .await?;
    } else {
        sqlx::query!(
            r#"
            update app_settings
            set enabled_providers = array_remove(enabled_providers, $1)
            where id = 1
            "#,
            key,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub struct EnabledProviderRow {
    pub key: String,
    pub display_name: String,
    pub description: Option<String>,
}

/// Account providers currently active in `app_settings.enabled_providers`.
/// Used by the connection-creation UI; returns no admin toggle flag.
pub async fn enabled_account_providers(
    pool: &sqlx::PgPool,
) -> Result<Vec<EnabledProviderRow>, CoreError> {
    let rows = sqlx::query_as!(
        EnabledProviderRow,
        r#"
        select p.key          as "key!",
               p.display_name as "display_name!",
               p.description
        from provider p
        cross join app_settings s
        where s.id = 1
          and p.kind = 'account'
          and p.key = any(s.enabled_providers)
        order by p.display_name
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
