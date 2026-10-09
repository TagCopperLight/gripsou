use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use gripsou_core::budget::ai::RunOutcome;
use gripsou_core::categorize::Categorizer;
use gripsou_core::db::Db;
use gripsou_core::provider::{AccountProvider, CompositionProvider, PriceProvider, ProviderError};
use gripsou_core::repo::connection;
use gripsou_core::repo::connection::BeginSync;
use gripsou_core::repo::settings::BudgetAiSettings;
use tracing::Instrument;
use uuid::Uuid;

const AWAITING_TIMEOUT_MINS: i32 = 5;
const PENDING_TIMEOUT_MINS: i32 = 10;

/// One cleanup pass: logs `sweep finished` with the count when it changed
/// something, `sweep failed` (error: whatever it cleans stays stuck) when
/// it could not run.
async fn sweep<F>(name: &'static str, run: F)
where
    F: std::future::Future<Output = Result<u64, gripsou_core::error::CoreError>>,
{
    async {
        match run.await {
            Ok(0) => {}
            Ok(n) => tracing::info!(count = n, "sweep finished"),
            Err(e) => tracing::error!(error = %gripsou_core::logs::error_chain(&e), "sweep failed"),
        }
    }
    .instrument(tracing::info_span!("sweep", name))
    .await
}

/// What started a sync's fetch. Logged on every line of the sync.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    /// The scheduler's daily pass.
    Daily,
    /// A user's "Sync now" / "Sync all" on a direct-fetch provider.
    Manual,
    /// The provider's webhook said its refresh finished.
    Webhook,
    /// No webhook within the awaiting timeout: fetched directly.
    WebhookTimeout,
    /// The first sync after a connection is completed.
    Initial,
    /// The provider refused the refresh as already up to date (409).
    AlreadyFresh,
}

impl Trigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Trigger::Daily => "daily",
            Trigger::Manual => "manual",
            Trigger::Webhook => "webhook",
            Trigger::WebhookTimeout => "webhook_timeout",
            Trigger::Initial => "initial",
            Trigger::AlreadyFresh => "already_fresh",
        }
    }
}

/// The span one sync runs in. Every line of the sync inherits these fields;
/// `provider` is recorded once read. Created where the sync is spawned, so a
/// sync started by a request is a child of its `request` span.
pub fn sync_span(user_id: Uuid, connection_id: Uuid, trigger: Trigger) -> tracing::Span {
    tracing::info_span!(
        "sync",
        sync_id = %Uuid::new_v4(),
        connection_id = %connection_id,
        user_id = %user_id,
        trigger = trigger.as_str(),
        provider = tracing::field::Empty,
    )
}

/// The adapters one sync uses. Built per sync (prices need the pivot).
pub struct SyncDeps {
    pub accounts: HashMap<String, Box<dyn AccountProvider>>,
    pub prices: Vec<Box<dyn PriceProvider>>,
    pub composition: Box<dyn CompositionProvider>,
}

impl SyncDeps {
    pub async fn from_env(db: &Db) -> SyncDeps {
        let pivot = gripsou_core::repo::settings::base_currency(db)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!(
                    error = %gripsou_core::logs::error_chain(&e),
                    "base currency unreadable, using EUR"
                );
                "EUR".to_string()
            });
        SyncDeps {
            accounts: account_providers()
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
            prices: price_providers(pivot),
            composition: Box::new(composition_provider()),
        }
    }
}

/// A sync that could not start, and why. Every caller that starts a sync
/// goes through this or [`spawn_sync`], so a refused or failed claim is
/// never silent.
fn skipped(reason: &'static str, user_id: Uuid, connection_id: Uuid, trigger: Trigger) {
    tracing::info!(
        reason,
        trigger = trigger.as_str(),
        connection_id = %connection_id,
        user_id = %user_id,
        "sync skipped"
    );
}

/// Run a claimed sync in the background, inside its `sync` span.
fn spawn_sync(db: Db, user_id: Uuid, connection_id: Uuid, trigger: Trigger) {
    let span = sync_span(user_id, connection_id, trigger);
    tokio::spawn(sync_connection(db, connection_id).instrument(span));
}

/// Claim the connection and spawn its sync, or log `sync skipped`.
async fn claim_and_spawn(db: &Db, user_id: Uuid, id: Uuid, trigger: Trigger) {
    match connection::begin_sync(db, user_id, id).await {
        Ok(BeginSync::Started(_)) => spawn_sync(db.clone(), user_id, id, trigger),
        Ok(BeginSync::AlreadySyncing) => skipped("already_running", user_id, id, trigger),
        Ok(BeginSync::NotFound) => skipped("not_found", user_id, id, trigger),
        Err(e) => {
            tracing::error!(
                error = %gripsou_core::logs::error_chain(&e),
                connection_id = %id,
                "sync claim failed"
            );
            skipped("read_failed", user_id, id, trigger);
        }
    }
}

/// In-process scheduler: hourly cleanup of expired auth sessions, and daily sync.
pub async fn run_scheduler(db: Db) {
    // Boot sweep: every 'syncing' row predates this process, so whatever held
    // the lock is gone. The scheduler runs in the API process and the app is
    // single-instance, so there is no sibling whose live claim this could steal.
    sweep("boot_sync_locks", connection::clear_stale_syncing(&db, 0)).await;
    sweep(
        "boot_ai_locks",
        gripsou_core::repo::budget::ai::clear_all_locks(&db),
    )
    .await;
    sweep(
        "boot_ai_runs",
        gripsou_core::repo::budget::ai::close_abandoned_runs(&db, None),
    )
    .await;
    tokio::spawn(prune_sessions(db.clone()));
    tokio::spawn(prune_logs(db.clone()));
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
                tracing::error!(
                    error = %gripsou_core::logs::error_chain(&e),
                    "awaiting connections read failed"
                );
                continue;
            }
        };
        for row in rows {
            claim_and_spawn(&db, row.user_id, row.id, Trigger::WebhookTimeout).await;
        }

        // A sync whose task died without a restart (panic, lost DB connection)
        // holds its lock until this clears it — see connection::clear_stale_syncing.
        sweep(
            "stale_sync_locks",
            connection::clear_stale_syncing(&db, connection::SYNC_LOCK_STALE_MINS),
        )
        .await;

        // Backstop for abandoned webview flows whose callback never ran.
        sweep(
            "stale_pending",
            connection::delete_stale_pending(&db, PENDING_TIMEOUT_MINS),
        )
        .await;
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
                tracing::error!(
                    error = %gripsou_core::logs::error_chain(&e),
                    "daily sync read failed"
                );
                continue;
            }
        };

        let due = rows.len();
        let mut started = 0usize;
        let mut per_user: HashMap<Uuid, Vec<tokio::task::JoinHandle<bool>>> = HashMap::new();
        for row in rows {
            // The claim prevents double-syncs.
            match connection::begin_sync(&db, row.user_id, row.id).await {
                Ok(BeginSync::Started(_)) => {
                    started += 1;
                    let span = sync_span(row.user_id, row.id, Trigger::Daily);
                    per_user.entry(row.user_id).or_default().push(tokio::spawn(
                        sync_connection_data(db.clone(), row.id).instrument(span),
                    ));
                }
                Ok(BeginSync::AlreadySyncing) => {
                    skipped("already_running", row.user_id, row.id, Trigger::Daily)
                }
                Ok(BeginSync::NotFound) => {
                    skipped("not_found", row.user_id, row.id, Trigger::Daily)
                }
                Err(e) => {
                    tracing::error!(
                        error = %gripsou_core::logs::error_chain(&e),
                        connection_id = %row.id,
                        "sync claim failed"
                    );
                    skipped("read_failed", row.user_id, row.id, Trigger::Daily);
                }
            }
        }
        if due > 0 {
            tracing::info!(
                due = due as u64,
                started = started as u64,
                "daily sync started"
            );
        }
        // One AI run per user, once every connection of theirs is in: a run
        // started after the first would miss the others' rows, and could pay
        // for transfer halves their pairing is about to claim.
        for (user_id, syncs) in per_user {
            let db = db.clone();
            tokio::spawn(async move {
                let mut any_ok = false;
                for s in syncs {
                    match s.await {
                        Ok(ok) => any_ok |= ok,
                        Err(e) => {
                            tracing::error!(user_id = %user_id, error = %e, "sync task crashed")
                        }
                    }
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
        sweep("sessions", gripsou_core::repo::session::delete_expired(&db)).await;
    }
}

async fn prune_logs(db: Db) {
    let mut tick = tokio::time::interval(Duration::from_secs(24 * 3600));
    loop {
        tick.tick().await;
        sweep(
            "logs",
            gripsou_core::repo::log::purge_older_than(&db, gripsou_core::logs::RETENTION_DAYS),
        )
        .await;
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
    match gripsou_providers::yahoo::YahooPriceProvider::new(pivot) {
        Ok(p) => v.push(Box::new(p)),
        Err(e) => tracing::error!(
            error = %gripsou_core::logs::error_chain(&e),
            "yahoo provider unavailable"
        ),
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

/// The models a provider offers for categorising, asked of the provider
/// itself. `None` when the provider is unknown or its key is not set.
pub async fn categorizer_models(
    kind: &str,
) -> Option<Result<Vec<String>, gripsou_core::categorize::CategorizeError>> {
    let k = categorizer_kind(kind)?;
    let c = (k.build)(k.default_model)?;
    Some(c.models().await)
}

async fn open_gate(db: &Db, user_id: Uuid) -> Option<(String, String)> {
    open_gate_with(db, user_id, &available_categorizers()).await
}

/// [`open_gate`] with the providers whose key is present passed in, so tests
/// need not touch the process-wide env.
async fn open_gate_with(db: &Db, user_id: Uuid, available: &[&str]) -> Option<(String, String)> {
    let settings = match gripsou_core::repo::settings::budget_ai(db).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %gripsou_core::logs::error_chain(&e), "ai settings unreadable");
            return None;
        }
    };
    settings.provider.as_ref()?;
    let enabled = match gripsou_core::repo::prefs::budget_ai_enabled(db, user_id).await {
        Ok(b) => b,
        Err(e) => {
            tracing::error!(user_id = %user_id, error = %gripsou_core::logs::error_chain(&e), "ai opt-in unreadable");
            return None;
        }
    };
    gate(&settings, enabled, available)
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
        tracing::error!(provider = %kind, "ai provider key missing");
        return;
    };
    match gripsou_core::budget::ai::run_for_user(&db, user_id, c.as_ref()).await {
        Ok(RunOutcome::Finished {
            outcome,
            items,
            batches,
        }) => tracing::info!(
            outcome = %outcome,
            items = items as i64,
            batches = batches as i64,
            "ai run finished"
        ),
        Ok(RunOutcome::Busy) => tracing::debug!("ai run skipped: another is running"),
        Ok(RunOutcome::Nothing) => tracing::debug!("ai run skipped: nothing to categorise"),
        Err(e) => tracing::error!(error = %gripsou_core::logs::error_chain(&e), "ai run failed"),
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
            let span = tracing::info_span!(
                "ai_run",
                user_id = %user_id,
                run_id = tracing::field::Empty,
                model = tracing::field::Empty,
            );
            guarded(&db, user_id, categorize_user(db.clone(), user_id))
                .instrument(span)
                .await;
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
    let Err(e) = tokio::spawn(run.in_current_span()).await else {
        return;
    };
    // The panic payload is in JoinError's Display.
    tracing::error!(user_id = %user_id, error = %e, "ai run crashed");
    if let Err(e) = gripsou_core::budget::ai::abandon(db, user_id).await {
        tracing::error!(
            user_id = %user_id,
            error = %gripsou_core::logs::error_chain(&e),
            "ai lock not released"
        );
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
            tracing::warn!(
                connection_id = %connection_id,
                error = %gripsou_core::logs::error_chain(&e),
                "ai run start failed"
            )
        }
    }
}

/// Why a sync stopped. `step` is `failed_step` in the log.
struct SyncFailure {
    step: &'static str,
    error: String,
}

fn failure(step: &'static str, error: impl Into<String>) -> SyncFailure {
    SyncFailure {
        step,
        error: error.into(),
    }
}

/// The sync itself, without the AI run. True when the data was ingested.
/// Runs inside a `sync_span`.
async fn sync_connection_data(db: Db, connection_id: Uuid) -> bool {
    let deps = SyncDeps::from_env(&db).await;
    sync_connection_data_with(&db, connection_id, &deps).await
}

/// [`sync_connection_data`] with its adapters passed in (tests use fakes).
/// Logs `sync started`, one line per step, and exactly one `sync finished`.
pub async fn sync_connection_data_with(db: &Db, connection_id: Uuid, deps: &SyncDeps) -> bool {
    let started = std::time::Instant::now();
    tracing::info!("sync started");
    match run_sync(db, connection_id, deps).await {
        Ok(s) => {
            // The write that releases the lock. If it fails the data is
            // already committed but the connection would sit on a spinner;
            // the stale-lock sweep is what eventually frees it.
            if let Err(e) = connection::mark_synced_ok(db, connection_id).await {
                tracing::error!(
                    error = %gripsou_core::logs::error_chain(&e),
                    "sync lock not released"
                );
            }
            // The sync-history line: keep its shape (jobs/tests/sync_log.rs).
            tracing::info!(
                outcome = "ok",
                duration_ms = started.elapsed().as_millis() as u64,
                accounts = s.accounts as u64,
                holdings = s.holdings as u64,
                transactions_inserted = s.transactions_inserted as u64,
                transactions_updated = s.transactions_updated as u64,
                holdings_closed = s.holdings_closed as u64,
                transfers_paired = s.transfers_paired as u64,
                "sync finished"
            );
            true
        }
        Err(f) => {
            if let Err(e) = connection::mark_synced_error(db, connection_id, &f.error).await {
                tracing::error!(
                    error = %gripsou_core::logs::error_chain(&e),
                    "sync failure not recorded"
                );
            }
            // The sync-history line: keep its shape (jobs/tests/sync_log.rs).
            tracing::error!(
                outcome = "failed",
                failed_step = f.step,
                error = %f.error,
                duration_ms = started.elapsed().as_millis() as u64,
                "sync finished"
            );
            false
        }
    }
}

async fn run_sync(
    db: &Db,
    connection_id: Uuid,
    deps: &SyncDeps,
) -> Result<gripsou_core::ingest::IngestSummary, SyncFailure> {
    use gripsou_core::logs::error_chain;
    let key = std::env::var("ENCRYPTION_KEY")
        .map_err(|_| failure("credentials", "ENCRYPTION_KEY not set"))?;
    let provider_key = connection::provider_key(db, connection_id)
        .await
        .map_err(|e| failure("credentials", error_chain(&e)))?
        .ok_or_else(|| failure("credentials", "connection no longer exists"))?;
    tracing::Span::current().record("provider", provider_key.as_str());
    let encrypted = connection::get_credentials(db, connection_id)
        .await
        .map_err(|e| failure("credentials", error_chain(&e)))?
        .ok_or_else(|| failure("credentials", "no credentials stored"))?;
    let credentials =
        decrypt_credentials(&key, &encrypted).map_err(|e| failure("credentials", e))?;
    let adapter = deps.accounts.get(provider_key.as_str()).ok_or_else(|| {
        failure(
            "provider_fetch",
            format!("no adapter for provider '{provider_key}'"),
        )
    })?;

    let t = std::time::Instant::now();
    let result = adapter
        .sync(&credentials)
        .await
        .map_err(|e| failure("provider_fetch", error_chain(&e)))?;
    tracing::info!(
        accounts = result.accounts.len() as u64,
        holdings = result.holdings.len() as u64,
        transactions = result.transactions.len() as u64,
        accounts_skipped = result.skipped.accounts as u64,
        holdings_skipped = result.skipped.holdings as u64,
        transactions_skipped = result.skipped.transactions as u64,
        duration_ms = t.elapsed().as_millis() as u64,
        "provider fetch finished"
    );

    let t = std::time::Instant::now();
    let s = gripsou_core::ingest::ingest(db, connection_id, &result)
        .await
        .map_err(|e| failure("ingest", error_chain(&e)))?;
    tracing::info!(
        accounts = s.accounts as u64,
        holdings = s.holdings as u64,
        transactions_inserted = s.transactions_inserted as u64,
        transactions_updated = s.transactions_updated as u64,
        transactions_skipped = s.transactions_skipped as u64,
        snapshots = s.snapshots as u64,
        holdings_closed = s.holdings_closed as u64,
        backfill_rows = s.backfill_rows as u64,
        transfers_paired = s.transfers_paired as u64,
        duration_ms = t.elapsed().as_millis() as u64,
        "ingest finished"
    );

    // Prices and composition are best-effort: a failure must not fail the sync.
    let t = std::time::Instant::now();
    match gripsou_core::price_sync::fetch_prices_for_connection(db, connection_id, &deps.prices)
        .await
    {
        Ok(p) => tracing::info!(
            resolved = p.resolved as u64,
            inserted = p.prices_inserted as u64,
            skipped_fresh = p.skipped_fresh as u64,
            unresolved = p.unresolved as u64,
            failed = p.failed as u64,
            skipped_unlabelled = p.skipped_unlabelled as u64,
            duration_ms = t.elapsed().as_millis() as u64,
            "price fetch finished"
        ),
        Err(e) => tracing::warn!(error = %error_chain(&e), "price fetch failed"),
    }
    let t = std::time::Instant::now();
    match gripsou_core::composition_sync::fetch_composition_for_connection(
        db,
        connection_id,
        deps.composition.as_ref(),
    )
    .await
    {
        Ok(c) => tracing::info!(
            resolved = c.resolved as u64,
            fetched = c.fetched as u64,
            unresolved = c.unresolved as u64,
            failed = c.failed as u64,
            duration_ms = t.elapsed().as_millis() as u64,
            "composition fetch finished"
        ),
        Err(e) => tracing::warn!(error = %error_chain(&e), "composition fetch failed"),
    }
    Ok(s)
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
        tracing::warn!(provider, reason = "unknown_provider", "webhook rejected");
        return WebhookOutcome::NotFound;
    };
    let signal = match adapter.verify_webhook(path, &headers, &body) {
        Ok(Some(s)) => s,
        Ok(None) => {
            // valid, ignored
            tracing::info!(provider, outcome = "ignored", "webhook received");
            return WebhookOutcome::Accepted;
        }
        Err(_) => {
            tracing::warn!(provider, reason = "bad_signature", "webhook rejected");
            return WebhookOutcome::Unauthorized;
        }
    };
    match connection::find_by_external_connection_id(&db, provider, &signal.provider_connection_id)
        .await
    {
        Ok(Some((id, user_id))) => {
            tracing::info!(provider, outcome = "matched", connection_id = %id, "webhook received");
            claim_and_spawn(&db, user_id, id, Trigger::Webhook).await;
        }
        Ok(None) => tracing::warn!(
            provider,
            outcome = "unknown_connection",
            external_connection_id = %signal.provider_connection_id,
            "webhook received"
        ),
        Err(e) => {
            tracing::error!(provider, error = %gripsou_core::logs::error_chain(&e), "webhook lookup failed")
        }
    }
    WebhookOutcome::Accepted
}

/// Entry point for a user-initiated or initial sync. Webhook providers:
/// request a provider refresh and await the webhook (status 'awaiting').
/// Others: direct full-fetch under `trigger`. Err only on a database failure.
pub async fn request_sync(
    db: Db,
    user_id: Uuid,
    id: Uuid,
    trigger: Trigger,
) -> Result<BeginSync, gripsou_core::error::CoreError> {
    let Some(conn) = connection::connection_for_sync(&db, user_id, id).await? else {
        skipped("not_found", user_id, id, trigger);
        return Ok(BeginSync::NotFound);
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

    let claim = if webhook {
        connection::begin_await(&db, user_id, id).await?
    } else {
        connection::begin_sync(&db, user_id, id).await?
    };
    match claim {
        BeginSync::Started(state) => {
            if webhook {
                tracing::info!(
                    connection_id = %id,
                    user_id = %user_id,
                    trigger = trigger.as_str(),
                    "refresh requested"
                );
                tokio::spawn(do_request_refresh(db.clone(), user_id, id, conn).in_current_span());
            } else {
                spawn_sync(db.clone(), user_id, id, trigger);
            }
            Ok(BeginSync::Started(state))
        }
        BeginSync::AlreadySyncing => {
            skipped("already_running", user_id, id, trigger);
            Ok(BeginSync::AlreadySyncing)
        }
        BeginSync::NotFound => {
            skipped("not_found", user_id, id, trigger);
            Ok(BeginSync::NotFound)
        }
    }
}

/// A refresh request that failed before any fetch: mark the connection's
/// error (which also releases the awaiting claim) and say why.
async fn refresh_failed(db: &Db, id: Uuid, msg: impl Into<String>) {
    let msg = msg.into();
    tracing::error!(connection_id = %id, error = %msg, "refresh request failed");
    if let Err(e) = connection::mark_synced_error(db, id, &msg).await {
        tracing::error!(
            connection_id = %id,
            error = %gripsou_core::logs::error_chain(&e),
            "refresh failure not recorded"
        );
    }
}

/// Decrypt creds and ask the provider to refresh. On failure, surface as error.
async fn do_request_refresh(db: Db, user_id: Uuid, id: Uuid, conn: connection::ConnForSync) {
    let key = match std::env::var("ENCRYPTION_KEY") {
        Ok(k) => k,
        Err(_) => {
            refresh_failed(&db, id, "ENCRYPTION_KEY not set").await;
            return;
        }
    };
    let creds = match decrypt_credentials(&key, &conn.credentials) {
        Ok(c) => c,
        Err(e) => {
            refresh_failed(&db, id, e).await;
            return;
        }
    };
    let providers = account_providers();
    let Some(adapter) = providers.get(conn.provider_key.as_str()) else {
        refresh_failed(
            &db,
            id,
            format!("no adapter for provider '{}'", conn.provider_key),
        )
        .await;
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
            tracing::info!(connection_id = %id, "refresh refused as already up to date");
            match connection::begin_sync(&db, user_id, id).await {
                Ok(BeginSync::Started(_)) => {
                    sync_connection(db.clone(), id)
                        .instrument(sync_span(user_id, id, Trigger::AlreadyFresh))
                        .await
                }
                Ok(BeginSync::AlreadySyncing) => {
                    skipped("already_running", user_id, id, Trigger::AlreadyFresh)
                }
                Ok(BeginSync::NotFound) => skipped("not_found", user_id, id, Trigger::AlreadyFresh),
                Err(e) => {
                    tracing::error!(
                        error = %gripsou_core::logs::error_chain(&e),
                        connection_id = %id,
                        "sync claim failed"
                    );
                    skipped("read_failed", user_id, id, Trigger::AlreadyFresh);
                }
            }
        }
        Err(e) => refresh_failed(&db, id, gripsou_core::logs::error_chain(&e)).await,
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
    tracing::info!(connection_id = %connection_id, user_id = %user_id, provider = provider_key, "connection created");

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
    tracing::info!(connection_id = %connection_id, user_id = %user_id, provider = %provider_key, "connection activated");
    // Kick an initial sync (webhook providers go 'awaiting'; others fetch now).
    // The connect itself has succeeded either way, so a failure here is logged,
    // not returned — but it must not be invisible.
    match request_sync(db.clone(), user_id, connection_id, Trigger::Initial).await {
        Ok(_) => {} // started or skipped: both already logged
        Err(e) => tracing::error!(
            connection_id = %connection_id,
            error = %gripsou_core::logs::error_chain(&e),
            "initial sync failed to start"
        ),
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

/// [`open_gate_with`] against a real database: the gate reads the admin's
/// provider from `app_settings` and the opt-in from the user's own prefs. The
/// available providers are passed in, never read from the env, so these tests
/// hold whatever keys the shell exports.
#[cfg(test)]
mod open_gate_tests {
    use super::*;
    use sqlx::PgPool;

    const AVAILABLE: &[&str] = &["gemini"];

    /// Insert a user whose prefs carry `budgetAiEnabled = opted_in`.
    async fn seed_user(pool: &PgPool, opted_in: bool) -> Uuid {
        sqlx::query_scalar(
            "insert into users (email, name, password_hash, prefs) \
             values (gen_random_uuid()::text || '@t.local', 'Test', 'x', \
                     jsonb_build_object('budgetAiEnabled', $1::boolean)) \
             returning id",
        )
        .bind(opted_in)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Set the admin's provider choice (`None` = AI off server-wide).
    async fn set_admin_provider(pool: &PgPool, provider: Option<&str>) {
        sqlx::query(
            "update app_settings set budget_ai_provider = $1, budget_ai_model = null where id = 1",
        )
        .bind(provider)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn ready(pool: &PgPool, user: Uuid) -> bool {
        open_gate_with(pool, user, AVAILABLE).await.is_some()
    }

    /// With neither the admin nor the user having switched the AI on, nothing runs.
    #[sqlx::test(migrations = "../migrations")]
    async fn closed_when_neither_admin_nor_user_enabled_it(pool: PgPool) {
        let user = seed_user(&pool, false).await;
        set_admin_provider(&pool, None).await;
        assert!(!ready(&pool, user).await);
    }

    /// The admin configuring a provider is not consent: a user who did not opt
    /// in never has their transactions sent to a model.
    #[sqlx::test(migrations = "../migrations")]
    async fn closed_when_only_the_admin_enabled_it(pool: PgPool) {
        let user = seed_user(&pool, false).await;
        set_admin_provider(&pool, Some("gemini")).await;
        assert!(!ready(&pool, user).await);
    }

    /// A user's opt-in alone does nothing while the admin has not picked a
    /// provider.
    #[sqlx::test(migrations = "../migrations")]
    async fn closed_when_only_the_user_opted_in(pool: PgPool) {
        let user = seed_user(&pool, true).await;
        set_admin_provider(&pool, None).await;
        assert!(!ready(&pool, user).await);
    }

    /// Admin provider with its key present plus user opt-in: the run may start,
    /// on the provider's default model since the admin left it blank.
    #[sqlx::test(migrations = "../migrations")]
    async fn open_when_admin_and_user_both_enabled_it(pool: PgPool) {
        let user = seed_user(&pool, true).await;
        set_admin_provider(&pool, Some("gemini")).await;
        assert_eq!(
            open_gate_with(&pool, user, AVAILABLE).await,
            Some((
                "gemini".to_string(),
                default_model("gemini").unwrap().to_string()
            ))
        );
    }

    /// The schema stores any provider key; one this build does not know (stale
    /// setting, typo) keeps the gate shut instead of failing mid-run.
    #[sqlx::test(migrations = "../migrations")]
    async fn closed_when_the_admin_named_an_unknown_provider(pool: PgPool) {
        let user = seed_user(&pool, true).await;
        set_admin_provider(&pool, Some("no-such-provider")).await;
        assert!(!ready(&pool, user).await);
    }

    /// The gate is per user: one user's opt-in never opens it for another.
    #[sqlx::test(migrations = "../migrations")]
    async fn one_users_opt_in_does_not_open_the_gate_for_another(pool: PgPool) {
        let opted_in = seed_user(&pool, true).await;
        let other = seed_user(&pool, false).await;
        set_admin_provider(&pool, Some("gemini")).await;
        assert!(ready(&pool, opted_in).await);
        assert!(!ready(&pool, other).await);
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

    /// One user's run must not block another's: the slot is per user, so a
    /// long run for A never leaves B's new rows uncategorised.
    #[test]
    fn run_slots_are_per_user() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        assert!(claim_run(a));
        assert!(claim_run(b), "B starts while A runs");
        assert!(!run_again(a), "A's slot is freed without a re-run");
        assert!(!run_again(b), "B was never asked twice either");
    }

    /// Simultaneous requests (several syncs finishing at once) start exactly
    /// one run: two would pay the model twice for the same rows.
    #[test]
    fn concurrent_requests_start_a_single_run() {
        let user = Uuid::new_v4();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(16));
        let handles: Vec<_> = (0..16)
            .map(|_| {
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    claim_run(user)
                })
            })
            .collect();
        let winners = handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|won| *won)
            .count();
        assert_eq!(winners, 1);
        assert!(run_again(user), "the losers asked for one more run");
        assert!(!run_again(user), "and only one");
    }

    /// A request while the user's run is in flight starts no second task: it
    /// only books one more round, which the running task picks up.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_request_during_a_run_books_a_rerun_instead_of_starting_one(pool: PgPool) {
        let user = Uuid::new_v4();
        assert!(claim_run(user), "a run is in flight");
        request_categorize(pool.clone(), user);
        request_categorize(pool.clone(), user);
        // Give a wrongly spawned task the chance to run and touch the slot.
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(ai_runs().get(&user), Some(&true), "one re-run is booked");
        assert!(run_again(user), "the running task goes round once more");
        assert!(!run_again(user), "then frees the slot");
    }

    /// A run that cannot start (AI off) must still free the user's slot, or
    /// every later request would be swallowed until a restart.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_run_that_cannot_start_frees_the_slot(pool: PgPool) {
        let user: Uuid = sqlx::query_scalar(
            "insert into users (email, name, password_hash) values ('s@x', 's', 'h') returning id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        request_categorize(pool.clone(), user);
        let freed = async {
            while ai_runs().contains_key(&user) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        };
        tokio::time::timeout(Duration::from_secs(10), freed)
            .await
            .expect("the slot is freed once the no-op run ends");
        assert!(claim_run(user), "the next request starts a run");
        assert!(!run_again(user));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_panicking_run_releases_the_lock_and_closes_its_row(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(100);
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

        writer.flush(&pool).await;
        let f: serde_json::Value =
            sqlx::query_scalar("select fields from log where message = 'ai run crashed'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(f["user_id"], user.to_string());
        assert!(f["error"].as_str().unwrap().contains("boom"));
    }
}

#[cfg(test)]
mod categorizer_registry_tests {
    use super::*;

    /// Every provider the admin may pick has a usable default model and a
    /// unique key: `gate` falls back to the default when the admin leaves the
    /// model blank, and a lookup by key must not be ambiguous.
    #[test]
    fn every_provider_has_a_unique_key_and_a_default_model() {
        let keys = categorizer_keys();
        let unique: std::collections::HashSet<_> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len(), "duplicate provider key");
        for key in keys {
            let model = default_model(key).unwrap_or_else(|| panic!("{key}: no default"));
            assert!(!model.trim().is_empty(), "{key}: blank default model");
        }
    }
}

#[cfg(test)]
mod credentials_tests {
    use super::*;
    use serde_json::json;

    const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const OTHER_KEY: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    fn creds() -> serde_json::Value {
        json!({ "access_token": "secret-token", "id_user": 42, "nested": { "a": [1, 2] } })
    }

    /// What `complete_connection` stores, every sync must read back unchanged,
    /// or the connection silently stops syncing.
    #[test]
    fn credentials_round_trip() {
        let blob = encrypt_credentials(KEY, &creds()).unwrap();
        assert_eq!(decrypt_credentials(KEY, &blob).unwrap(), creds());
    }

    /// The stored blob is the versioned envelope and never contains the
    /// plaintext secret.
    #[test]
    fn stored_blob_is_the_v1_envelope_without_plaintext() {
        let blob = encrypt_credentials(KEY, &creds()).unwrap();
        assert_eq!(blob["v"], 1);
        assert!(blob["ct"].is_string());
        assert_eq!(blob.as_object().unwrap().len(), 2);
        assert!(!blob.to_string().contains("secret-token"));
    }

    /// A rotated or wrong `ENCRYPTION_KEY` must fail the sync, not hand the
    /// provider garbage credentials.
    #[test]
    fn decrypting_with_the_wrong_key_fails() {
        let blob = encrypt_credentials(KEY, &creds()).unwrap();
        assert!(decrypt_credentials(OTHER_KEY, &blob).is_err());
    }

    /// A tampered ciphertext is rejected (authenticated encryption), not
    /// decoded into altered credentials.
    #[test]
    fn a_tampered_ciphertext_fails() {
        use base64::{Engine, engine::general_purpose::STANDARD};
        let blob = encrypt_credentials(KEY, &creds()).unwrap();
        let mut bytes = STANDARD.decode(blob["ct"].as_str().unwrap()).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        let tampered = json!({ "v": 1, "ct": STANDARD.encode(&bytes) });
        assert!(decrypt_credentials(KEY, &tampered).is_err());
    }

    /// A blob without a usable `ct` (plaintext credentials, a missing or
    /// non-string `ct`, non-base64, null) is an error, never passed through
    /// to the provider as if it were credentials. `v` is not checked: v1 is
    /// the only envelope, so a future v2 must add that check.
    #[test]
    fn a_malformed_blob_is_an_error() {
        for blob in [
            json!(null),
            json!({}),
            json!({ "v": 1 }),
            json!({ "v": 1, "ct": 5 }),
            json!({ "v": 1, "ct": null }),
            json!({ "v": 1, "ct": "not base64 !!" }),
            json!({ "v": 1, "ct": "" }),
            json!({ "access_token": "plain" }),
            json!("just a string"),
        ] {
            assert!(
                decrypt_credentials(KEY, &blob).is_err(),
                "accepted malformed blob {blob}"
            );
        }
    }

    /// An invalid server key refuses to encrypt rather than storing anything
    /// readable.
    #[test]
    fn encrypting_with_an_invalid_key_fails() {
        assert!(encrypt_credentials("too-short", &creds()).is_err());
        assert!(encrypt_credentials(&"z".repeat(64), &creds()).is_err());
    }
}
