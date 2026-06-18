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
