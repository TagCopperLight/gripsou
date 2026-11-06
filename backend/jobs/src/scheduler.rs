//! The in-process scheduler: the daily sync, the webhook-timeout fallback
//! and the cleanup sweeps.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use gripsou_core::db::Db;
use gripsou_core::error::CoreError;
use gripsou_core::logs::error_chain;
use gripsou_core::repo::connection;
use tracing::Instrument;
use uuid::Uuid;

use crate::Deps;
use crate::ai::categorize_after;
use crate::sync::{Trigger, claim};

const AWAITING_TIMEOUT_MINS: i32 = 5;
const PENDING_TIMEOUT_MINS: i32 = 10;
/// A connection is due for its daily sync this long after its last one: a
/// little under a day, so the hourly check does not drift it later each day.
const DAILY_SYNC_AFTER_HOURS: i32 = 23;

/// One cleanup pass: logs `sweep finished` with the count when it changed
/// something, `sweep failed` (error: whatever it cleans stays stuck) when
/// it could not run.
async fn sweep<F>(name: &'static str, run: F)
where
    F: std::future::Future<Output = Result<u64, CoreError>>,
{
    async {
        match run.await {
            Ok(0) => {}
            Ok(n) => tracing::info!(count = n, "sweep finished"),
            Err(e) => tracing::error!(error = %error_chain(&e), "sweep failed"),
        }
    }
    .instrument(tracing::info_span!("sweep", name))
    .await
}

/// In-process scheduler: hourly cleanup of expired auth sessions, and daily sync.
pub async fn run_scheduler(db: Db, deps: Arc<Deps>) {
    // Boot sweep: every 'syncing' row predates this process, so whatever held
    // the lock is gone. The scheduler runs in the API process and the app is
    // single-instance, so there is no sibling whose live claim this could steal.
    sweep("boot_sync_locks", connection::clear_syncing(&db)).await;
    sweep(
        "boot_ai_runs",
        gripsou_core::repo::budget::ai::close_abandoned_runs(&db, None),
    )
    .await;
    tokio::spawn(prune_sessions(db.clone()));
    tokio::spawn(prune_logs(db.clone()));
    tokio::spawn(sync_all_daily(db.clone(), deps.clone()));
    tokio::spawn(reap_awaiting(db, deps));
}

async fn reap_awaiting(db: Db, deps: Arc<Deps>) {
    let mut tick = tokio::time::interval(Duration::from_secs(60));
    loop {
        tick.tick().await;
        let rows = match connection::connections_awaiting_timeout(&db, AWAITING_TIMEOUT_MINS).await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(
                    error = %error_chain(&e),
                    "awaiting connections read failed"
                );
                continue;
            }
        };
        for row in rows {
            if let Some(claimed) = claim(&db, row.user_id, row.id, Trigger::WebhookTimeout).await {
                claimed.start(db.clone(), deps.clone());
            }
        }

        // Backstop for abandoned webview flows whose callback never ran.
        sweep(
            "stale_pending",
            connection::delete_stale_pending(&db, PENDING_TIMEOUT_MINS),
        )
        .await;
    }
}

async fn sync_all_daily(db: Db, deps: Arc<Deps>) {
    let mut tick = tokio::time::interval(Duration::from_secs(3600));
    loop {
        tick.tick().await;
        let rows = match connection::connections_needing_sync(&db, DAILY_SYNC_AFTER_HOURS).await {
            Ok(rows) => rows,
            Err(e) => {
                tracing::error!(
                    error = %error_chain(&e),
                    "daily sync read failed"
                );
                continue;
            }
        };

        let due = rows.len();
        let mut started = 0usize;
        let mut per_user: HashMap<Uuid, Vec<tokio::task::JoinHandle<bool>>> = HashMap::new();
        for row in rows {
            if let Some(claimed) = claim(&db, row.user_id, row.id, Trigger::Daily).await {
                started += 1;
                let sync = claimed.spawn(db.clone(), deps.clone());
                per_user.entry(row.user_id).or_default().push(sync);
            }
        }
        if due > 0 {
            tracing::info!(
                due = due as u64,
                started = started as u64,
                "daily sync started"
            );
        }
        for (user_id, syncs) in per_user {
            tokio::spawn(categorize_after(db.clone(), deps.clone(), user_id, syncs));
        }
    }
}

async fn prune_sessions(db: Db) {
    let mut tick = tokio::time::interval(Duration::from_secs(3600));
    loop {
        tick.tick().await;
        sweep("sessions", gripsou_core::repo::session::delete_expired(&db)).await;
        sweep(
            "login_challenges",
            gripsou_core::repo::login_challenge::delete_expired(&db),
        )
        .await;
        sweep(
            "totp_setups",
            gripsou_core::repo::mfa::delete_stale_setups(&db),
        )
        .await;
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
