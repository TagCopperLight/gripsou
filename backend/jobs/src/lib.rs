use std::collections::HashMap;
use std::time::Duration;

use gripsou_core::db::Db;
use gripsou_core::provider::{AccountProvider, PriceProvider};
use gripsou_core::repo::connection;
use uuid::Uuid;

/// In-process scheduler. For now: hourly cleanup of expired auth sessions.
pub async fn run_scheduler(db: Db) {
    tokio::spawn(prune_sessions(db));
}

async fn prune_sessions(db: Db) {
    let mut tick = tokio::time::interval(Duration::from_secs(3600));
    loop {
        tick.tick().await;
        match gripsou_core::repo::session::delete_expired(&db).await {
            Ok(n) if n > 0 => tracing::info!("pruned {n} expired session(s)"),
            Ok(_) => {}
            Err(e) => tracing::warn!("session prune failed: {e}"),
        }
    }
}

/// Account-provider adapters keyed by provider key. Providers absent from env
/// are omitted rather than panicking — the caller sees "no adapter" errors.
fn account_providers() -> HashMap<&'static str, Box<dyn AccountProvider>> {
    let mut m: HashMap<&'static str, Box<dyn AccountProvider>> = HashMap::new();
    if let Some(p) = gripsou_providers::powens::PowensProvider::from_env() {
        m.insert("powens", Box::new(p));
    }
    m
}

/// Price-provider adapters. Yahoo needs no credentials, so it is always
/// registered (unless the connector fails to construct).
fn price_providers() -> Vec<Box<dyn PriceProvider>> {
    let mut v: Vec<Box<dyn PriceProvider>> = Vec::new();
    if let Ok(p) = gripsou_providers::yahoo::YahooPriceProvider::new() {
        v.push(Box::new(p));
    }
    v
}

fn encrypt_credentials(
    key_hex: &str,
    creds: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let plaintext = serde_json::to_vec(creds).map_err(|e| e.to_string())?;
    let ct = gripsou_core::crypto::encrypt(key_hex, &plaintext).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "v": 1, "ct": ct }))
}

fn decrypt_credentials(
    key_hex: &str,
    blob: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let ct = blob["ct"]
        .as_str()
        .ok_or_else(|| "missing 'ct' in stored credentials".to_string())?;
    let plaintext = gripsou_core::crypto::decrypt(key_hex, ct).map_err(|e| e.to_string())?;
    serde_json::from_slice(&plaintext).map_err(|e| e.to_string())
}

/// Run one connection's sync to completion, updating its status. Fetches and
/// decrypts credentials from the DB before calling the adapter.
pub async fn sync_connection(db: Db, connection_id: Uuid) {
    let encryption_key = match std::env::var("ENCRYPTION_KEY") {
        Ok(k) => k,
        Err(_) => {
            let _ =
                connection::mark_synced_error(&db, connection_id, "ENCRYPTION_KEY not set").await;
            return;
        }
    };

    let provider_key = match connection::provider_key(&db, connection_id).await {
        Ok(Some(k)) => k,
        Ok(None) => return,
        Err(e) => {
            let _ = connection::mark_synced_error(&db, connection_id, &e.to_string()).await;
            return;
        }
    };

    let encrypted_creds = match connection::get_credentials(&db, connection_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            let _ =
                connection::mark_synced_error(&db, connection_id, "no credentials stored").await;
            return;
        }
        Err(e) => {
            let _ = connection::mark_synced_error(&db, connection_id, &e.to_string()).await;
            return;
        }
    };

    let credentials = match decrypt_credentials(&encryption_key, &encrypted_creds) {
        Ok(v) => v,
        Err(e) => {
            let _ = connection::mark_synced_error(&db, connection_id, &e).await;
            return;
        }
    };

    let providers = account_providers();
    let Some(adapter) = providers.get(provider_key.as_str()) else {
        let _ = connection::mark_synced_error(
            &db,
            connection_id,
            &format!("no adapter for provider '{provider_key}'"),
        )
        .await;
        return;
    };

    let result = match adapter.sync(&credentials).await {
        Ok(r) => r,
        Err(e) => {
            let _ = connection::mark_synced_error(&db, connection_id, &e.to_string()).await;
            return;
        }
    };

    match gripsou_core::ingest::ingest(&db, connection_id, &result).await {
        Ok(_) => {
            // Prices are best-effort: a failure here must not fail the sync.
            match gripsou_core::price_sync::fetch_prices_for_connection(
                &db,
                connection_id,
                &price_providers(),
            )
            .await
            {
                Ok(s) => tracing::info!(
                    "prices for {connection_id}: resolved={} inserted={} skipped_fresh={} unresolved={} skipped_currency={}",
                    s.resolved, s.prices_inserted, s.skipped_fresh, s.unresolved, s.skipped_currency
                ),
                Err(e) => tracing::warn!("price fetch errored for {connection_id}: {e}"),
            }
            let _ = connection::mark_synced_ok(&db, connection_id).await;
        }
        Err(e) => {
            let _ = connection::mark_synced_error(&db, connection_id, &e.to_string()).await;
        }
    }
}

/// Begin a provider connection: check the adapter exists, call `connect()`,
/// create a pending DB row, and append `state=<id>` to the redirect URL.
///
/// Calling `connect()` before inserting the row avoids leaving orphaned
/// pending rows when the provider refuses (e.g. env vars not set).
pub async fn init_connection(
    db: Db,
    user_id: uuid::Uuid,
    provider_key: &str,
    display_name: &str,
) -> Result<(uuid::Uuid, gripsou_core::provider::ConnectInit), gripsou_core::provider::ProviderError>
{
    use gripsou_core::provider::{ConnectInit, ProviderError};

    let providers = account_providers();
    let adapter = providers
        .get(provider_key)
        .ok_or_else(|| ProviderError::Other(format!("no adapter for provider '{provider_key}'")))?;

    let init = adapter.connect().await?;

    let connection_id =
        gripsou_core::repo::connection::insert_pending(&db, user_id, provider_key, display_name)
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

    let init = ConnectInit {
        redirect_url: init.redirect_url.map(|url| {
            let sep = if url.contains('?') { '&' } else { '?' };
            format!("{url}{sep}state={connection_id}")
        }),
    };

    Ok((connection_id, init))
}

/// Complete a pending connection: call `complete_connect()`, encrypt the
/// returned credentials, and flip status to 'ok'.
pub async fn complete_connection(
    db: Db,
    user_id: uuid::Uuid,
    connection_id: uuid::Uuid,
    params: &std::collections::HashMap<String, String>,
) -> Result<(), gripsou_core::provider::ProviderError> {
    use gripsou_core::provider::ProviderError;

    let encryption_key = std::env::var("ENCRYPTION_KEY")
        .map_err(|_| ProviderError::Other("ENCRYPTION_KEY not set".into()))?;

    let provider_key = gripsou_core::repo::connection::provider_key(&db, connection_id)
        .await
        .map_err(|e| ProviderError::Other(e.to_string()))?
        .ok_or_else(|| ProviderError::Other("connection not found".to_string()))?;

    let providers = account_providers();
    let adapter = providers
        .get(provider_key.as_str())
        .ok_or_else(|| ProviderError::Other(format!("no adapter for '{provider_key}'")))?;

    let query: String = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");

    let credentials = adapter.complete_connect(&query).await?;

    let encrypted =
        encrypt_credentials(&encryption_key, &credentials).map_err(ProviderError::Other)?;

    let updated =
        gripsou_core::repo::connection::finish_connect(&db, connection_id, user_id, encrypted)
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;
    if !updated {
        return Err(ProviderError::Other("connection not found".to_string()));
    }
    Ok(())
}
