use std::collections::HashMap;
use std::time::Duration;

use gripsou_core::db::Db;
use gripsou_core::provider::AccountProvider;
use gripsou_core::repo::connection;
use gripsou_providers::powens::PowensProvider;
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

/// Account-provider adapters keyed by provider key. Adding a provider is a
/// registration here — no core or schema change.
fn account_providers() -> HashMap<&'static str, Box<dyn AccountProvider>> {
    let mut m: HashMap<&'static str, Box<dyn AccountProvider>> = HashMap::new();
    m.insert("powens", Box::new(PowensProvider));
    m
}

/// Run one connection's sync to completion, updating its status. Looks up the
/// adapter, pulls a `SyncResult`, ingests it, and stamps ok/error. The caller
/// is expected to have already claimed the connection (status='syncing') via
/// `connection::begin_sync`. With the current stub adapters this ends in
/// `error` ("provider not implemented") — expected until a real adapter lands.
pub async fn sync_connection(db: Db, connection_id: Uuid) {
    let key = match connection::provider_key(&db, connection_id).await {
        Ok(Some(k)) => k,
        Ok(None) => return, // connection vanished; nothing to do
        Err(e) => {
            let _ = connection::mark_synced_error(&db, connection_id, &e.to_string()).await;
            return;
        }
    };

    let providers = account_providers();
    let Some(adapter) = providers.get(key.as_str()) else {
        let _ = connection::mark_synced_error(
            &db,
            connection_id,
            &format!("no adapter for provider '{key}'"),
        )
        .await;
        return;
    };

    let result = match adapter.sync().await {
        Ok(r) => r,
        Err(e) => {
            let _ = connection::mark_synced_error(&db, connection_id, &e.to_string()).await;
            return;
        }
    };

    match gripsou_core::ingest::ingest(&db, connection_id, &result).await {
        Ok(_) => {
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
/// pending rows when the provider stub returns NotImplemented.
pub async fn init_connection(
    db: Db,
    user_id: uuid::Uuid,
    provider_key: &str,
    display_name: &str,
) -> Result<(uuid::Uuid, gripsou_core::provider::ConnectInit), gripsou_core::provider::ProviderError> {
    use gripsou_core::provider::{ConnectInit, ProviderError};

    let providers = account_providers();
    let adapter = providers.get(provider_key).ok_or_else(|| {
        ProviderError::Other(format!("no adapter for provider '{provider_key}'"))
    })?;

    // Call connect() first — if the adapter refuses, no DB row is created.
    let init = adapter.connect().await?;

    let connection_id =
        gripsou_core::repo::connection::insert_pending(&db, user_id, provider_key, display_name)
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

    // Append state=<connection_id> so the callback page can identify the connection.
    let init = ConnectInit {
        redirect_url: init.redirect_url.map(|url| {
            let sep = if url.contains('?') { '&' } else { '?' };
            format!("{url}{sep}state={connection_id}")
        }),
    };

    Ok((connection_id, init))
}

/// Complete a pending connection: call `complete_connect()`, store the
/// returned credentials, and flip status to 'ok'.
pub async fn complete_connection(
    db: Db,
    user_id: uuid::Uuid,
    connection_id: uuid::Uuid,
    params: &std::collections::HashMap<String, String>,
) -> Result<(), gripsou_core::provider::ProviderError> {
    use gripsou_core::provider::ProviderError;

    let provider_key =
        gripsou_core::repo::connection::provider_key(&db, connection_id)
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?
            .ok_or_else(|| ProviderError::Other("connection not found".to_string()))?;

    let providers = account_providers();
    let adapter = providers.get(provider_key.as_str()).ok_or_else(|| {
        ProviderError::Other(format!("no adapter for provider '{provider_key}'"))
    })?;

    // Encode remaining params as a query string for the trait's `callback: &str`.
    let query: String = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");

    let credentials = adapter.complete_connect(&query).await?;

    let updated = gripsou_core::repo::connection::finish_connect(&db, connection_id, user_id, credentials)
        .await
        .map_err(|e| ProviderError::Other(e.to_string()))?;
    if !updated {
        return Err(ProviderError::Other("connection not found".to_string()));
    }

    Ok(())
}
