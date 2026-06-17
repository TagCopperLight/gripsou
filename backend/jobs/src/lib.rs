use std::time::Duration;

use gripsou_core::db::Db;

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
