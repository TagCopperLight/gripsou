//! One connection's sync: claiming its lock, running it supervised, and
//! starting it the way its provider refreshes.

use std::sync::Arc;

use gripsou_core::db::Db;
use gripsou_core::error::CoreError;
use gripsou_core::ingest::IngestSummary;
use gripsou_core::logs::error_chain;
use gripsou_core::provider::{Refresh, RefreshMode};
use gripsou_core::repo::connection::{self, BeginSync};
use tracing::Instrument;
use uuid::Uuid;

use crate::{Deps, credentials};

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
    /// The provider answered a refresh request as already up to date.
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
fn sync_span(user_id: Uuid, connection_id: Uuid, trigger: Trigger) -> tracing::Span {
    tracing::info_span!(
        "sync",
        sync_id = %Uuid::new_v4(),
        connection_id = %connection_id,
        user_id = %user_id,
        trigger = trigger.as_str(),
        provider = tracing::field::Empty,
    )
}

/// A sync that could not start, and why.
fn skipped(reason: &'static str, user_id: Uuid, connection_id: Uuid, trigger: Trigger) {
    tracing::info!(
        reason,
        trigger = trigger.as_str(),
        connection_id = %connection_id,
        user_id = %user_id,
        "sync skipped"
    );
}

/// Logs a claim that was not granted as `sync skipped`. True when granted.
fn granted(outcome: &BeginSync, user_id: Uuid, connection_id: Uuid, trigger: Trigger) -> bool {
    match outcome {
        BeginSync::Started(_) => return true,
        BeginSync::AlreadySyncing => skipped("already_running", user_id, connection_id, trigger),
        BeginSync::NotFound => skipped("not_found", user_id, connection_id, trigger),
    }
    false
}

/// A connection whose sync lock this process holds: the only way into a
/// sync. The sync releases the lock however it ends.
pub(crate) struct Claimed {
    user_id: Uuid,
    connection_id: Uuid,
    trigger: Trigger,
}

/// Takes the connection's sync lock, or logs why not.
pub(crate) async fn claim(
    db: &Db,
    user_id: Uuid,
    connection_id: Uuid,
    trigger: Trigger,
) -> Option<Claimed> {
    let outcome = match connection::begin_sync(db, user_id, connection_id).await {
        Ok(o) => o,
        Err(e) => {
            tracing::error!(
                error = %error_chain(&e),
                connection_id = %connection_id,
                "sync claim failed"
            );
            skipped("read_failed", user_id, connection_id, trigger);
            return None;
        }
    };
    granted(&outcome, user_id, connection_id, trigger).then_some(Claimed {
        user_id,
        connection_id,
        trigger,
    })
}

impl Claimed {
    /// Runs the sync in the background, in its `sync` span (a child of the
    /// current one, so a sync a request started is under its `request`).
    /// The handle says whether the data was ingested.
    pub(crate) fn spawn(self, db: Db, deps: Arc<Deps>) -> tokio::task::JoinHandle<bool> {
        let span = sync_span(self.user_id, self.connection_id, self.trigger);
        tokio::spawn(supervise(db, deps, self.connection_id).instrument(span))
    }

    /// The sync, then the user's AI run.
    pub(crate) fn start(self, db: Db, deps: Arc<Deps>) {
        let user_id = self.user_id;
        let sync = self.spawn(db.clone(), deps.clone());
        tokio::spawn(crate::ai::categorize_after(db, deps, user_id, vec![sync]).in_current_span());
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
/// Runs inside a `sync_span` and logs `sync started`, one line per step and
/// exactly one `sync finished`, a panic or a timeout included: the sync runs
/// in its own task, and if that task panics or outlives `deps.time_limit` it
/// is stopped, the connection's lock is released and `sync finished` says
/// `failed_step = "panic"` or `"timeout"`.
async fn supervise(db: Db, deps: Arc<Deps>, connection_id: Uuid) -> bool {
    let started = std::time::Instant::now();
    let limit = deps.time_limit;
    let task_db = db.clone();
    let task = async move { run_sync_logged(&task_db, connection_id, &deps).await };
    let mut handle = tokio::spawn(task.in_current_span());
    let (step, message, error) = match tokio::time::timeout(limit, &mut handle).await {
        Ok(Ok(ok)) => return ok,
        // The panic payload is in JoinError's Display.
        Ok(Err(e)) => ("panic", "sync crashed", e.to_string()),
        Err(_) => {
            // Dropping the handle would leave the task running: stop it. Its
            // open DB transaction, if any, is rolled back.
            handle.abort();
            match handle.await {
                // It finished before the abort landed, and has already
                // released the lock and logged its `sync finished`.
                Ok(ok) => return ok,
                Err(e) if e.is_panic() => ("panic", "sync crashed", e.to_string()),
                Err(_) => {
                    let error = format!("still running after {} minutes", limit.as_secs() / 60);
                    ("timeout", "sync took too long", error)
                }
            }
        }
    };
    if let Err(e) = connection::mark_synced_error(&db, connection_id, message).await {
        tracing::error!(
            error = %error_chain(&e),
            "sync failure not recorded"
        );
    }
    // The sync-history line: keep its shape (jobs/tests/sync_log.rs).
    tracing::error!(
        outcome = "failed",
        failed_step = step,
        error = %error,
        duration_ms = started.elapsed().as_millis() as u64,
        "sync finished"
    );
    false
}

/// One sync, start to `sync finished`, unsupervised: only [`supervise`]
/// calls it.
async fn run_sync_logged(db: &Db, connection_id: Uuid, deps: &Deps) -> bool {
    let started = std::time::Instant::now();
    tracing::info!("sync started");
    match run_sync(db, connection_id, deps).await {
        Ok(s) => {
            // The write that releases the lock. If it fails the data is
            // already committed but the connection sits on a spinner until
            // the next restart clears it.
            if let Err(e) = connection::mark_synced_ok(db, connection_id).await {
                tracing::error!(
                    error = %error_chain(&e),
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
                    error = %error_chain(&e),
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

async fn run_sync(db: &Db, connection_id: Uuid, deps: &Deps) -> Result<IngestSummary, SyncFailure> {
    let source = connection::sync_source(db, connection_id)
        .await
        .map_err(|e| failure("credentials", error_chain(&e)))?
        .ok_or_else(|| failure("credentials", "connection no longer exists"))?;
    let provider_key = source.provider_key;
    tracing::Span::current().record("provider", provider_key.as_str());
    let credentials =
        credentials::open(&deps.key, &source.credentials).map_err(|e| failure("credentials", e))?;
    let adapter = deps.account(provider_key.as_str()).ok_or_else(|| {
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

/// Entry point for a user-initiated or initial sync. Webhook providers:
/// request a provider refresh and await the webhook (status 'awaiting').
/// Others: direct full-fetch under `trigger`. Err only on a database failure.
pub async fn request_sync(
    db: Db,
    deps: &Arc<Deps>,
    user_id: Uuid,
    id: Uuid,
    trigger: Trigger,
) -> Result<BeginSync, CoreError> {
    let Some(conn) = connection::connection_for_sync(&db, user_id, id).await? else {
        skipped("not_found", user_id, id, trigger);
        return Ok(BeginSync::NotFound);
    };

    let webhook = deps
        .account(conn.provider_key.as_str())
        .is_some_and(|a| a.refresh_mode(&conn.provider_meta) == RefreshMode::Webhook);

    // A webhook provider's lock is `awaiting` until its webhook claims the sync.
    let outcome = if webhook {
        connection::begin_await(&db, user_id, id).await
    } else {
        connection::begin_sync(&db, user_id, id).await
    }?;
    if granted(&outcome, user_id, id, trigger) {
        if webhook {
            tracing::info!(
                connection_id = %id,
                user_id = %user_id,
                trigger = trigger.as_str(),
                "refresh requested"
            );
            tokio::spawn(
                do_request_refresh(db.clone(), deps.clone(), user_id, id, conn).in_current_span(),
            );
        } else {
            let claimed = Claimed {
                user_id,
                connection_id: id,
                trigger,
            };
            claimed.start(db.clone(), deps.clone());
        }
    }
    Ok(outcome)
}

/// A refresh request that failed before any fetch: mark the connection's
/// error (which also releases the awaiting claim) and say why.
async fn refresh_failed(db: &Db, id: Uuid, msg: impl Into<String>) {
    let msg = msg.into();
    tracing::error!(connection_id = %id, error = %msg, "refresh request failed");
    if let Err(e) = connection::mark_synced_error(db, id, &msg).await {
        tracing::error!(
            connection_id = %id,
            error = %error_chain(&e),
            "refresh failure not recorded"
        );
    }
}

/// Decrypt creds and ask the provider to refresh. On failure, surface as error.
async fn do_request_refresh(
    db: Db,
    deps: Arc<Deps>,
    user_id: Uuid,
    id: Uuid,
    conn: connection::ConnForSync,
) {
    let creds = match credentials::open(&deps.key, &conn.credentials) {
        Ok(c) => c,
        Err(e) => {
            refresh_failed(&db, id, e).await;
            return;
        }
    };
    let Some(adapter) = deps.account(conn.provider_key.as_str()) else {
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
        Ok(Refresh::Requested) => {}
        // No webhook will come: fetch now rather than wait for the
        // awaiting-timeout reaper.
        Ok(Refresh::AlreadyFresh) => {
            tracing::info!(connection_id = %id, "refresh refused as already up to date");
            if let Some(claimed) = claim(&db, user_id, id, Trigger::AlreadyFresh).await {
                claimed.start(db, deps);
            }
        }
        Err(e) => refresh_failed(&db, id, error_chain(&e)).await,
    }
}
