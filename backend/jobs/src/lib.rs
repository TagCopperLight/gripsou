use std::collections::HashMap;
use std::time::Duration;

use gripsou_core::db::Db;
use gripsou_core::provider::{AccountProvider, PriceProvider};
use gripsou_core::repo::connection;
use gripsou_core::repo::connection::BeginSync;
use uuid::Uuid;

const AWAITING_TIMEOUT_MINS: i32 = 5;
const PENDING_TIMEOUT_MINS: i32 = 10;

/// Mark a connection's sync as failed and log why. Centralizes the
/// previously-silent `mark_synced_error` call sites so failures show in logs.
async fn fail_sync(db: &Db, id: Uuid, msg: impl Into<String>) {
    let msg = msg.into();
    tracing::warn!("sync failed for {id}: {msg}");
    let _ = connection::mark_synced_error(db, id, &msg).await;
}

/// In-process scheduler: hourly cleanup of expired auth sessions, and daily sync.
pub async fn run_scheduler(db: Db) {
    tokio::spawn(prune_sessions(db.clone()));
    tokio::spawn(sync_all_daily(db.clone()));
    tokio::spawn(reap_awaiting(db));
}

async fn reap_awaiting(db: Db) {
    let mut tick = tokio::time::interval(Duration::from_secs(60));
    loop {
        tick.tick().await;
        let rows = match connection::connections_awaiting_timeout(&db, AWAITING_TIMEOUT_MINS).await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("reaper query failed: {e}");
                continue;
            }
        };
        for row in rows {
            if let Ok(connection::BeginSync::Started(_)) =
                connection::begin_sync(&db, row.user_id, row.id).await
            {
                tracing::info!("awaiting webhook timed out for {}; direct fetch", row.id);
                tokio::spawn(sync_connection(db.clone(), row.id));
            }
        }

        // Backstop for abandoned webview flows whose callback never ran.
        match connection::delete_stale_pending(&db, PENDING_TIMEOUT_MINS).await {
            Ok(n) if n > 0 => tracing::info!("reaped {n} stale pending connection(s)"),
            Ok(_) => {}
            Err(e) => tracing::warn!("stale pending reap failed: {e}"),
        }
    }
}

async fn sync_all_daily(db: Db) {
    // Check every hour for connections that haven't been synced in ~24h
    let mut tick = tokio::time::interval(Duration::from_secs(3600));
    loop {
        tick.tick().await;
        let rows = match connection::connections_needing_sync(&db).await {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!("daily sync failed to fetch connections: {e}");
                continue;
            }
        };

        for row in rows {
            // Attempt to claim the connection; prevents double-syncs
            if let Ok(connection::BeginSync::Started(_)) =
                connection::begin_sync(&db, row.user_id, row.id).await
            {
                tokio::spawn(sync_connection(db.clone(), row.id));
            }
        }
    }
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
            fail_sync(&db, connection_id, "ENCRYPTION_KEY not set").await;
            return;
        }
    };

    let provider_key = match connection::provider_key(&db, connection_id).await {
        Ok(Some(k)) => k,
        Ok(None) => return,
        Err(e) => {
            fail_sync(&db, connection_id, e.to_string()).await;
            return;
        }
    };

    let encrypted_creds = match connection::get_credentials(&db, connection_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            fail_sync(&db, connection_id, "no credentials stored").await;
            return;
        }
        Err(e) => {
            fail_sync(&db, connection_id, e.to_string()).await;
            return;
        }
    };

    let credentials = match decrypt_credentials(&encryption_key, &encrypted_creds) {
        Ok(v) => v,
        Err(e) => {
            fail_sync(&db, connection_id, e).await;
            return;
        }
    };

    let providers = account_providers();
    let Some(adapter) = providers.get(provider_key.as_str()) else {
        fail_sync(
            &db,
            connection_id,
            format!("no adapter for provider '{provider_key}'"),
        )
        .await;
        return;
    };

    let result = match adapter.sync(&credentials).await {
        Ok(r) => r,
        Err(e) => {
            fail_sync(&db, connection_id, e.to_string()).await;
            return;
        }
    };

    match gripsou_core::ingest::ingest(&db, connection_id, &result).await {
        Ok(summary) => {
            tracing::info!(
                "sync ok for {connection_id}: accounts={} holdings={} txns={} closed={}",
                summary.accounts,
                summary.holdings,
                summary.transactions_inserted,
                summary.holdings_closed,
            );
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
                    s.resolved,
                    s.prices_inserted,
                    s.skipped_fresh,
                    s.unresolved,
                    s.skipped_currency
                ),
                Err(e) => tracing::warn!("price fetch errored for {connection_id}: {e}"),
            }
            let _ = connection::mark_synced_ok(&db, connection_id).await;
        }
        Err(e) => {
            fail_sync(&db, connection_id, e.to_string()).await;
        }
    }
}

pub enum WebhookOutcome {
    NotFound,     // unknown provider
    Unauthorized, // signature rejected
    Accepted,     // verified (acted, ignored, or unknown connection)
}

/// Verify an incoming webhook and, if it signals a finished sync, claim the
/// connection and run the full-fetch. Always returns Accepted on a valid
/// signature so the provider stops retrying.
pub async fn handle_webhook(
    db: Db,
    provider: &str,
    path: &str,
    headers: std::collections::HashMap<String, String>,
    body: Vec<u8>,
) -> WebhookOutcome {
    let providers = account_providers();
    let Some(adapter) = providers.get(provider) else {
        return WebhookOutcome::NotFound;
    };
    let signal = match adapter.verify_webhook(path, &headers, &body) {
        Ok(Some(s)) => s,
        Ok(None) => return WebhookOutcome::Accepted, // valid, ignored
        Err(_) => return WebhookOutcome::Unauthorized,
    };
    match connection::find_by_external_connection_id(&db, provider, &signal.provider_connection_id)
        .await
    {
        Ok(Some((id, user_id))) => {
            if let Ok(BeginSync::Started(_)) = connection::begin_sync(&db, user_id, id).await {
                tokio::spawn(sync_connection(db.clone(), id));
            }
        }
        Ok(None) => tracing::warn!(
            "webhook for unknown {provider} connection {}",
            signal.provider_connection_id
        ),
        Err(e) => tracing::warn!("webhook correlation failed: {e}"),
    }
    WebhookOutcome::Accepted
}

/// Entry point for user-initiated sync. Webhook providers: request a provider
/// refresh and await the webhook (status 'awaiting'). Others: direct full-fetch.
pub async fn request_sync(db: Db, user_id: Uuid, id: Uuid) -> BeginSync {
    let conn = match connection::connection_for_sync(&db, user_id, id).await {
        Ok(Some(c)) => c,
        Ok(None) => return BeginSync::NotFound,
        Err(e) => {
            tracing::warn!("request_sync read failed: {e}");
            return BeginSync::NotFound;
        }
    };

    let providers = account_providers();
    let has_external_id = conn
        .provider_meta
        .get("external_connection_id")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty());
    let webhook = providers
        .get(conn.provider_key.as_str())
        .map(|a| a.webhooks_enabled())
        .unwrap_or(false)
        && has_external_id;

    if !webhook {
        // Direct path (today's behavior).
        match connection::begin_sync(&db, user_id, id).await {
            Ok(BeginSync::Started(state)) => {
                tokio::spawn(sync_connection(db.clone(), id));
                BeginSync::Started(state)
            }
            Ok(other) => other,
            Err(_) => BeginSync::NotFound,
        }
    } else {
        match connection::begin_await(&db, user_id, id).await {
            Ok(BeginSync::Started(state)) => {
                tokio::spawn(do_request_refresh(db.clone(), id, conn));
                BeginSync::Started(state)
            }
            Ok(other) => other,
            Err(_) => BeginSync::NotFound,
        }
    }
}

/// Decrypt creds and ask the provider to refresh. On failure, surface as error.
async fn do_request_refresh(db: Db, id: Uuid, conn: connection::ConnForSync) {
    let key = match std::env::var("ENCRYPTION_KEY") {
        Ok(k) => k,
        Err(_) => {
            fail_sync(&db, id, "ENCRYPTION_KEY not set").await;
            return;
        }
    };
    let creds = match decrypt_credentials(&key, &conn.credentials) {
        Ok(c) => c,
        Err(e) => {
            fail_sync(&db, id, e).await;
            return;
        }
    };
    let providers = account_providers();
    let Some(adapter) = providers.get(conn.provider_key.as_str()) else {
        fail_sync(&db, id, "no adapter").await;
        return;
    };
    if let Err(e) = adapter.request_refresh(&creds, &conn.provider_meta).await {
        fail_sync(&db, id, e.to_string()).await;
    }
    // On success: stays 'awaiting'; the webhook (or reaper) drives the fetch.
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

    let completed = adapter.complete_connect(&query).await?;
    let encrypted = encrypt_credentials(&encryption_key, &completed.credentials)
        .map_err(ProviderError::Other)?;

    let updated = gripsou_core::repo::connection::finish_connect(
        &db,
        connection_id,
        user_id,
        encrypted,
        completed.provider_meta,
    )
    .await
    .map_err(|e| ProviderError::Other(e.to_string()))?;
    if !updated {
        return Err(ProviderError::Other("connection not found".to_string()));
    }
    // Kick an initial sync (webhook providers go 'awaiting'; others fetch now).
    let _ = request_sync(db.clone(), user_id, connection_id).await;
    Ok(())
}
