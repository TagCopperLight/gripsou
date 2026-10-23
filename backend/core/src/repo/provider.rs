//! Which account providers the admin turned on: `app_settings.enabled_providers`.
//! The catalog itself (names, descriptions, adapters) is in code
//! (`gripsou_jobs::ACCOUNT_PROVIDERS`). Global (not user-scoped).

use crate::error::CoreError;

/// The keys in `app_settings.enabled_providers`.
pub async fn enabled(pool: &sqlx::PgPool) -> Result<Vec<String>, CoreError> {
    let keys = sqlx::query_scalar!(
        r#"select enabled_providers as "enabled_providers!" from app_settings where id = 1"#
    )
    .fetch_one(pool)
    .await?;
    Ok(keys)
}

/// Add or remove `key` from app_settings.enabled_providers. Idempotent: adding
/// an already-present key (or removing an absent one) is a no-op.
pub async fn set_enabled(pool: &sqlx::PgPool, key: &str, enabled: bool) -> Result<(), CoreError> {
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
