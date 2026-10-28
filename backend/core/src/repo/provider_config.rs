//! `app_settings.provider_config`: each provider's fields as one encrypted
//! JSON object, so adding a provider needs no migration.

use std::collections::BTreeMap;

use sqlx::types::Json;

use crate::crypto::EncryptionKey;
use crate::error::CoreError;
use crate::provider_config::ProviderConfig;

type Stored = BTreeMap<String, String>;

pub struct Loaded {
    pub config: ProviderConfig,
    /// Providers whose bundle could not be decrypted (`ENCRYPTION_KEY`
    /// changed): treated as not set up.
    pub unreadable: Vec<String>,
}

fn decode(key: &EncryptionKey, blob: &str) -> Option<BTreeMap<String, String>> {
    serde_json::from_slice(&key.decrypt(blob).ok()?).ok()
}

fn decode_all(key: &EncryptionKey, stored: &Stored) -> Loaded {
    let mut config = ProviderConfig::default();
    let mut unreadable = Vec::new();
    for (provider, blob) in stored {
        match decode(key, blob) {
            Some(fields) => config.insert_provider(provider.clone(), fields),
            None => unreadable.push(provider.clone()),
        }
    }
    Loaded { config, unreadable }
}

pub async fn load(pool: &sqlx::PgPool, key: &EncryptionKey) -> Result<Loaded, CoreError> {
    let stored = sqlx::query_scalar!(
        r#"select provider_config as "c!: Json<Stored>" from app_settings where id = 1"#
    )
    .fetch_one(pool)
    .await?;
    Ok(decode_all(key, &stored.0))
}

/// Sets (or, with `None`, removes) one field and returns every provider's
/// values as now stored. A bundle that can't be decrypted starts afresh.
pub async fn set_field(
    pool: &sqlx::PgPool,
    key: &EncryptionKey,
    provider: &str,
    field: &str,
    value: Option<&str>,
) -> Result<ProviderConfig, CoreError> {
    let mut tx = pool.begin().await?;
    let mut stored = sqlx::query_scalar!(
        r#"select provider_config as "c!: Json<Stored>" from app_settings where id = 1 for update"#
    )
    .fetch_one(&mut *tx)
    .await?
    .0;
    let mut fields = stored
        .get(provider)
        .and_then(|b| decode(key, b))
        .unwrap_or_default();
    match value {
        Some(v) => fields.insert(field.to_string(), v.to_string()),
        None => fields.remove(field),
    };
    if fields.is_empty() {
        stored.remove(provider);
    } else {
        stored.insert(
            provider.to_string(),
            key.encrypt(&serde_json::to_vec(&fields)?)?,
        );
    }
    sqlx::query!(
        "update app_settings set provider_config = $1 where id = 1",
        Json(&stored) as _,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(decode_all(key, &stored).config)
}
