use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use gripsou_core::categorize::Categorizer;
use gripsou_core::db::Db;
use gripsou_core::provider::{AccountProvider, PriceProvider, ProviderError};
use gripsou_core::repo::connection;
use gripsou_core::repo::connection::BeginSync;
use gripsou_core::repo::settings::BudgetAiSettings;
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
    // Boot sweep: every 'syncing' row predates this process, so whatever held
    // the lock is gone. The scheduler runs in the API process and the app is
    // single-instance, so there is no sibling whose live claim this could steal.
    match connection::clear_stale_syncing(&db, 0).await {
        Ok(n) if n > 0 => {
            tracing::warn!("released {n} sync lock(s) left behind by a previous process")
        }
        Ok(_) => {}
        Err(e) => tracing::warn!("boot sync-lock sweep failed: {e}"),
    }
    match gripsou_core::repo::budget::ai::clear_all_locks(&db).await {
        Ok(n) if n > 0 => {
            tracing::warn!("released {n} budget AI lock(s) left behind by a previous process")
        }
        Ok(_) => {}
        Err(e) => tracing::warn!("boot budget-AI-lock sweep failed: {e}"),
    }
    match gripsou_core::repo::budget::ai::close_abandoned_runs(&db, None).await {
        Ok(n) if n > 0 => {
            tracing::warn!("closed {n} budget AI run(s) left running by a previous process")
        }
        Ok(_) => {}
        Err(e) => tracing::warn!("boot budget-AI-run sweep failed: {e}"),
    }
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

        // A sync whose task died without a restart (panic, lost DB connection)
        // holds its lock until this clears it — see connection::clear_stale_syncing.
        match connection::clear_stale_syncing(&db, connection::SYNC_LOCK_STALE_MINS).await {
            Ok(n) if n > 0 => tracing::warn!("released {n} stale sync lock(s)"),
            Ok(_) => {}
            Err(e) => tracing::warn!("stale sync-lock sweep failed: {e}"),
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

        let mut per_user: HashMap<Uuid, Vec<tokio::task::JoinHandle<bool>>> = HashMap::new();
        for row in rows {
            // Attempt to claim the connection; prevents double-syncs
            if let Ok(connection::BeginSync::Started(_)) =
                connection::begin_sync(&db, row.user_id, row.id).await
            {
                per_user
                    .entry(row.user_id)
                    .or_default()
                    .push(tokio::spawn(sync_connection_data(db.clone(), row.id)));
            }
        }
        // One AI run per user, once every connection of theirs is in: a run
        // started after the first would miss the others' rows, and could pay
        // for transfer halves their pairing is about to claim.
        for (user_id, syncs) in per_user {
            let db = db.clone();
            tokio::spawn(async move {
                let mut any_ok = false;
                for s in syncs {
                    any_ok |= s.await.unwrap_or(false);
                }
                if any_ok {
                    request_categorize(db, user_id);
                }
            });
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
/// registered (unless the connector fails to construct). `pivot` is the FX
/// storage currency, needed to build `{currency}{pivot}=X` symbols.
fn price_providers(pivot: String) -> Vec<Box<dyn PriceProvider>> {
    let mut v: Vec<Box<dyn PriceProvider>> = Vec::new();
    if let Ok(p) = gripsou_providers::yahoo::YahooPriceProvider::new(pivot) {
        v.push(Box::new(p));
    }
    v
}

fn composition_provider() -> gripsou_providers::boursorama::BoursoramaCompositionProvider {
    gripsou_providers::boursorama::BoursoramaCompositionProvider::new_default()
}

/// One categorisation provider this build knows. The adapter owns its env key
/// and the "blank means off" rule; this table is the only list of providers,
/// so adding one touches no schema.
struct CategorizerKind {
    key: &'static str,
    default_model: &'static str,
    configured: fn() -> bool,
    build: fn(&str) -> Option<Box<dyn Categorizer>>,
}

const CATEGORIZERS: &[CategorizerKind] = &[
    CategorizerKind {
        key: "gemini",
        default_model: gripsou_providers::gemini::GeminiCategorizer::DEFAULT_MODEL,
        configured: || gripsou_providers::gemini::GeminiCategorizer::api_key_from_env().is_some(),
        build: |model| {
            gripsou_providers::gemini::GeminiCategorizer::from_env(model)
                .map(|c| Box::new(c) as Box<dyn Categorizer>)
        },
    },
    CategorizerKind {
        key: "jev",
        default_model: gripsou_providers::jev::JevCategorizer::DEFAULT_MODEL,
        configured: || gripsou_providers::jev::JevCategorizer::api_key_from_env().is_some(),
        build: |model| {
            gripsou_providers::jev::JevCategorizer::from_env(model)
                .map(|c| Box::new(c) as Box<dyn Categorizer>)
        },
    },
];

fn categorizer_kind(key: &str) -> Option<&'static CategorizerKind> {
    CATEGORIZERS.iter().find(|k| k.key == key)
}

/// Every provider key this build knows, configured or not — what the admin
/// setting may name.
pub fn categorizer_keys() -> Vec<&'static str> {
    CATEGORIZERS.iter().map(|k| k.key).collect()
}

/// Providers whose API key is in the environment — the admin dropdown's
/// options. A provider without a key is never offered.
pub fn available_categorizers() -> Vec<&'static str> {
    CATEGORIZERS
        .iter()
        .filter(|k| (k.configured)())
        .map(|k| k.key)
        .collect()
}

pub fn default_model(kind: &str) -> Option<&'static str> {
    categorizer_kind(kind).map(|k| k.default_model)
}

/// Pure gate: `(provider, model)` when the server has a provider whose key is
/// present and the user opted in.
fn gate(
    settings: &BudgetAiSettings,
    user_enabled: bool,
    available: &[&str],
) -> Option<(String, String)> {
    let kind = settings.provider.as_deref()?;
    if !user_enabled || !available.contains(&kind) {
        return None;
    }
    let model = settings
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .or_else(|| default_model(kind))?;
    Some((kind.to_string(), model.to_string()))
}

fn categorizer(kind: &str, model: &str) -> Option<Box<dyn Categorizer>> {
    (categorizer_kind(kind)?.build)(model)
}

async fn open_gate(db: &Db, user_id: Uuid) -> Option<(String, String)> {
    let settings = match gripsou_core::repo::settings::budget_ai(db).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("budget AI settings unreadable: {e}");
            return None;
        }
    };
    settings.provider.as_ref()?;
    let enabled = match gripsou_core::repo::prefs::budget_ai_enabled(db, user_id).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("budget AI opt-in unreadable for {user_id}: {e}");
            return None;
        }
    };
    gate(&settings, enabled, &available_categorizers())
}

/// Whether a run would actually start — the API answers 409 when not.
pub async fn categorize_ready(db: &Db, user_id: Uuid) -> bool {
    open_gate(db, user_id).await.is_some()
}

/// Categorise one user's uncategorised rows. Never fails loudly: a run that
/// cannot start logs why; a run that fails, on the model or on the database,
/// records it in `budget_ai_run` for the banner.
pub async fn categorize_user(db: Db, user_id: Uuid) {
    let Some((kind, model)) = open_gate(&db, user_id).await else {
        return;
    };
    let Some(c) = categorizer(&kind, &model) else {
        tracing::warn!("budget AI provider '{kind}' is configured but its API key is not set");
        return;
    };
    match gripsou_core::budget::ai::run_for_user(&db, user_id, c.as_ref()).await {
        Ok(outcome) => tracing::info!("budget AI run for {user_id}: {outcome:?}"),
        Err(e) => tracing::warn!("budget AI run for {user_id} failed: {e}"),
    }
}

/// Users with a run in this process, and whether another was asked for
/// meanwhile. The app is single-process, so this is every live run.
static AI_RUNS: LazyLock<Mutex<HashMap<Uuid, bool>>> = LazyLock::new(Default::default);

fn ai_runs() -> std::sync::MutexGuard<'static, HashMap<Uuid, bool>> {
    AI_RUNS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Claims the user's run slot. False when a run is going: it is then asked to
/// go round once more instead.
fn claim_run(user_id: Uuid) -> bool {
    let mut runs = ai_runs();
    if let Some(again) = runs.get_mut(&user_id) {
        *again = true;
        return false;
    }
    runs.insert(user_id, false);
    true
}

/// After a run: true when another was asked for meanwhile (the slot is kept
/// for it), false when the slot is freed.
fn run_again(user_id: Uuid) -> bool {
    let mut runs = ai_runs();
    match runs.get_mut(&user_id) {
        Some(again) if *again => {
            *again = false;
            true
        }
        _ => {
            runs.remove(&user_id);
            false
        }
    }
}

/// Fire and forget: the run can take minutes. A request while the user's run
/// is going is not dropped: one more run follows it, however many requests
/// arrived, so rows a later sync brought in are not left for tomorrow.
pub fn request_categorize(db: Db, user_id: Uuid) {
    if !claim_run(user_id) {
        return;
    }
    tokio::spawn(async move {
        loop {
            guarded(&db, user_id, categorize_user(db.clone(), user_id)).await;
            if !run_again(user_id) {
                break;
            }
        }
    });
}

/// Runs `run` in its own task so a panic is caught: the user's run row is
/// then closed as failed and the AI lock released, instead of holding the
/// user until a restart. Only for the task that owns the user's run.
async fn guarded<F>(db: &Db, user_id: Uuid, run: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    let Err(e) = tokio::spawn(run).await else {
        return;
    };
    tracing::warn!("budget AI run for {user_id} died: {e}");
    if let Err(e) = gripsou_core::budget::ai::abandon(db, user_id).await {
        tracing::warn!("budget AI lock for {user_id} not released after a crash: {e}");
    }
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

/// Run one connection's sync to completion, updating its status, then
/// categorise the user's new rows. Fetches and decrypts credentials from the
/// DB before calling the adapter.
pub async fn sync_connection(db: Db, connection_id: Uuid) {
    if !sync_connection_data(db.clone(), connection_id).await {
        return;
    }
    // After the lock is released: categorising must never hold a sync.
    match connection::user_id(&db, connection_id).await {
        Ok(Some(user_id)) => request_categorize(db, user_id),
        Ok(None) => {}
        Err(e) => {
            tracing::warn!("could not start budget AI after sync of {connection_id}: {e}")
        }
    }
}

/// The sync itself, without the AI run. True when the data was ingested.
async fn sync_connection_data(db: Db, connection_id: Uuid) -> bool {
    let encryption_key = match std::env::var("ENCRYPTION_KEY") {
        Ok(k) => k,
        Err(_) => {
            fail_sync(&db, connection_id, "ENCRYPTION_KEY not set").await;
            return false;
        }
    };

    let provider_key = match connection::provider_key(&db, connection_id).await {
        Ok(Some(k)) => k,
        Ok(None) => return false,
        Err(e) => {
            fail_sync(&db, connection_id, e.to_string()).await;
            return false;
        }
    };

    let encrypted_creds = match connection::get_credentials(&db, connection_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            fail_sync(&db, connection_id, "no credentials stored").await;
            return false;
        }
        Err(e) => {
            fail_sync(&db, connection_id, e.to_string()).await;
            return false;
        }
    };

    let credentials = match decrypt_credentials(&encryption_key, &encrypted_creds) {
        Ok(v) => v,
        Err(e) => {
            fail_sync(&db, connection_id, e).await;
            return false;
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
        return false;
    };

    let result = match adapter.sync(&credentials).await {
        Ok(r) => r,
        Err(e) => {
            fail_sync(&db, connection_id, e.to_string()).await;
            return false;
        }
    };

    match gripsou_core::ingest::ingest(&db, connection_id, &result).await {
        Ok(summary) => {
            tracing::info!(
                "sync ok for {connection_id}: accounts={} holdings={} txns={} closed={} transfers_paired={}",
                summary.accounts,
                summary.holdings,
                summary.transactions_inserted,
                summary.holdings_closed,
                summary.transfers_paired,
            );
            // Prices are best-effort: a failure here must not fail the sync.
            let pivot = gripsou_core::repo::settings::base_currency(&db)
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!("failed to read base_currency, defaulting to EUR: {e}");
                    "EUR".to_string()
                });
            match gripsou_core::price_sync::fetch_prices_for_connection(
                &db,
                connection_id,
                &price_providers(pivot),
            )
            .await
            {
                Ok(s) => tracing::info!(
                    "prices for {connection_id}: resolved={} inserted={} skipped_fresh={} unresolved={} skipped_unlabelled={}",
                    s.resolved,
                    s.prices_inserted,
                    s.skipped_fresh,
                    s.unresolved,
                    s.skipped_unlabelled
                ),
                Err(e) => tracing::warn!("price fetch errored for {connection_id}: {e}"),
            }
            // Composition is best-effort too: a failure must not fail the sync.
            match gripsou_core::composition_sync::fetch_composition_for_connection(
                &db,
                connection_id,
                &composition_provider(),
            )
            .await
            {
                Ok(s) => tracing::info!(
                    "composition for {connection_id}: resolved={} fetched={} unresolved={}",
                    s.resolved,
                    s.fetched,
                    s.unresolved
                ),
                Err(e) => tracing::warn!("composition fetch errored for {connection_id}: {e}"),
            }
            // The write that releases the lock. If it fails the data is already
            // committed but the connection would sit on a spinner, so say so —
            // the stale-lock sweep is what eventually frees it.
            if let Err(e) = connection::mark_synced_ok(&db, connection_id).await {
                tracing::warn!(
                    "sync for {connection_id} succeeded but the lock was not released: {e}"
                );
            }
            true
        }
        Err(e) => {
            fail_sync(&db, connection_id, e.to_string()).await;
            false
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
                tokio::spawn(do_request_refresh(db.clone(), user_id, id, conn));
                BeginSync::Started(state)
            }
            Ok(other) => other,
            Err(_) => BeginSync::NotFound,
        }
    }
}

/// Decrypt creds and ask the provider to refresh. On failure, surface as error.
async fn do_request_refresh(db: Db, user_id: Uuid, id: Uuid, conn: connection::ConnForSync) {
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
    match adapter.request_refresh(&creds, &conn.provider_meta).await {
        // On success the connection stays 'awaiting'; the webhook (or the
        // awaiting-timeout reaper) drives the fetch.
        Ok(()) => {}
        // Provider says the connection is already up to date (no webhook will
        // come). Don't error — fall back to a direct full-fetch immediately
        // rather than waiting for the awaiting-timeout reaper.
        Err(ProviderError::Conflict) => {
            if let Ok(BeginSync::Started(_)) = connection::begin_sync(&db, user_id, id).await {
                sync_connection(db.clone(), id).await;
            }
        }
        Err(e) => fail_sync(&db, id, e.to_string()).await,
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
    use gripsou_core::provider::ConnectInit;

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
    // The connect itself has succeeded either way, so a failure here is logged,
    // not returned — but it must not be invisible.
    match request_sync(db.clone(), user_id, connection_id).await {
        BeginSync::Started(_) => {}
        BeginSync::AlreadySyncing => {
            tracing::info!("initial sync for {connection_id} skipped: already running")
        }
        BeginSync::NotFound => {
            tracing::warn!("initial sync for {connection_id} skipped: connection not readable")
        }
    }
    Ok(())
}

#[cfg(test)]
mod categorize_gate_tests {
    use super::*;
    use gripsou_core::repo::settings::BudgetAiSettings;

    fn s(p: Option<&str>, m: Option<&str>) -> BudgetAiSettings {
        BudgetAiSettings {
            provider: p.map(str::to_string),
            model: m.map(str::to_string),
        }
    }

    #[test]
    fn closed_when_the_server_has_no_provider() {
        assert_eq!(gate(&s(None, None), true, &["gemini"]), None);
    }

    #[test]
    fn closed_when_the_user_has_not_opted_in() {
        assert_eq!(gate(&s(Some("gemini"), None), false, &["gemini"]), None);
    }

    #[test]
    fn closed_when_the_key_is_missing() {
        assert_eq!(gate(&s(Some("jev"), None), true, &["gemini"]), None);
    }

    #[test]
    fn open_with_the_default_model_when_none_is_set() {
        assert_eq!(
            gate(&s(Some("gemini"), Some("  ")), true, &["gemini"]),
            Some(("gemini".to_string(), "gemini-3.5-flash-lite".to_string()))
        );
        assert_eq!(
            gate(&s(Some("jev"), Some("jev-2")), true, &["jev"]),
            Some(("jev".to_string(), "jev-2".to_string()))
        );
    }
}

#[cfg(test)]
mod categorize_run_tests {
    use super::*;
    use sqlx::PgPool;

    #[test]
    fn requests_during_a_run_coalesce_into_one_more_run() {
        let user = Uuid::new_v4();
        assert!(claim_run(user), "the first request starts a run");
        assert!(!claim_run(user), "a second one waits for it");
        assert!(!claim_run(user), "and a third joins the second");
        assert!(run_again(user), "one more run follows");
        assert!(!run_again(user), "then the slot is freed");
        assert!(claim_run(user), "and the next request starts afresh");
        assert!(!run_again(user));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_panicking_run_releases_the_lock_and_closes_its_row(pool: PgPool) {
        let user: Uuid = sqlx::query_scalar(
            "insert into users (email, name, password_hash) values ('p@x', 'p', 'h') returning id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let p = pool.clone();
        guarded(&pool, user, async move {
            assert!(
                gripsou_core::repo::budget::ai::try_lock(&p, user)
                    .await
                    .unwrap()
            );
            gripsou_core::repo::budget::ai::start_run(&p, user, "mock:m")
                .await
                .unwrap();
            panic!("boom");
        })
        .await;

        assert!(
            !gripsou_core::repo::budget::ai::is_locked(&pool, user)
                .await
                .unwrap()
        );
        let run = gripsou_core::repo::budget::ai::last_run(&pool, user)
            .await
            .unwrap()
            .expect("the dead run is reported");
        assert_eq!(run.outcome, "error");
    }
}
