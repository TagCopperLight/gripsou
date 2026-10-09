use chrono::{Duration, Utc};
use gripsou_core::logs::LogLine;
use serde_json::json;
use sqlx::PgPool;

fn line(at: chrono::DateTime<Utc>, message: &str) -> LogLine {
    LogLine {
        at,
        level: "info",
        target: "gripsou_test".into(),
        message: message.into(),
        fields: json!({ "connection_id": "c1" }),
    }
}

#[sqlx::test(migrations = "../migrations")]
async fn insert_batch_writes_every_line(pool: PgPool) {
    let now = Utc::now();
    let n = gripsou_core::repo::log::insert_batch(&pool, &[line(now, "a"), line(now, "b")])
        .await
        .unwrap();
    assert_eq!(n, 2);
    let rows: Vec<(String, String, serde_json::Value)> =
        sqlx::query_as("select level, message, fields from log order by id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, "info");
    assert_eq!(rows[0].1, "a");
    assert_eq!(rows[0].2["connection_id"], "c1");
}

#[sqlx::test(migrations = "../migrations")]
async fn purge_deletes_only_rows_older_than_the_retention(pool: PgPool) {
    let now = Utc::now();
    gripsou_core::repo::log::insert_batch(
        &pool,
        &[
            line(now - Duration::days(91), "old"),
            line(now - Duration::days(89), "recent"),
        ],
    )
    .await
    .unwrap();
    let deleted = gripsou_core::repo::log::purge_older_than(&pool, 90)
        .await
        .unwrap();
    assert_eq!(deleted, 1);
    let left: Vec<String> = sqlx::query_scalar("select message from log")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(left, vec!["recent".to_string()]);
}

/// Install a subscriber that only has the saving layer, for the current
/// thread (sqlx::test runs a current-thread runtime, so spawned tasks too).
fn install(
    capacity: usize,
) -> (
    tracing::subscriber::DefaultGuard,
    gripsou_core::logs::LogWriter,
) {
    gripsou_core::logs::capture(capacity)
}

async fn saved(pool: &PgPool) -> Vec<(String, String, String, serde_json::Value)> {
    sqlx::query_as("select level, target, message, fields from log order by id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn info_lines_are_saved_with_their_span_fields(pool: PgPool) {
    let (_g, mut writer) = install(100);
    let span = tracing::info_span!(target: "gripsou_jobs", "sync", connection_id = "c1", user_id = tracing::field::Empty);
    span.record("user_id", "u1");
    span.in_scope(|| {
        tracing::info!(target: "gripsou_jobs", accounts = 3_u64, "ingest finished");
    });
    assert_eq!(writer.flush(&pool).await, 1);
    let rows = saved(&pool).await;
    assert_eq!(rows.len(), 1);
    let (level, target, message, fields) = &rows[0];
    assert_eq!(level, "info");
    assert_eq!(target, "gripsou_jobs");
    assert_eq!(message, "ingest finished");
    assert_eq!(fields["connection_id"], "c1");
    assert_eq!(
        fields["user_id"], "u1",
        "fields recorded after creation are kept"
    );
    assert_eq!(fields["accounts"], 3);
    assert_eq!(fields["spans"], serde_json::json!(["sync"]));
}

#[sqlx::test(migrations = "../migrations")]
async fn inner_span_and_event_fields_win(pool: PgPool) {
    let (_g, mut writer) = install(100);
    let outer = tracing::info_span!(target: "gripsou_api", "request", step = "outer");
    let inner =
        outer.in_scope(|| tracing::info_span!(target: "gripsou_jobs", "sync", step = "inner"));
    inner.in_scope(|| tracing::warn!(target: "gripsou_jobs", step = "event", "price fetch failed"));
    writer.flush(&pool).await;
    let rows = saved(&pool).await;
    assert_eq!(rows[0].0, "warn");
    assert_eq!(rows[0].3["step"], "event");
    assert_eq!(rows[0].3["spans"], serde_json::json!(["request", "sync"]));
}

#[sqlx::test(migrations = "../migrations")]
async fn debug_lines_and_other_crates_are_not_saved(pool: PgPool) {
    let (_g, mut writer) = install(100);
    tracing::debug!(target: "gripsou_jobs", "routine detail");
    tracing::info!(target: "sqlx::query", "select 1");
    tracing::error!(target: "hyper", "connection reset");
    assert_eq!(writer.flush(&pool).await, 0);
    assert!(saved(&pool).await.is_empty());
}

#[sqlx::test(migrations = "../migrations")]
async fn a_full_queue_drops_lines_and_says_how_many(pool: PgPool) {
    let (_g, mut writer) = install(2);
    for i in 0..5 {
        tracing::info!(target: "gripsou_jobs", i, "tick");
    }
    writer.flush(&pool).await;
    let rows = saved(&pool).await;
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].0, "warn");
    assert_eq!(rows[0].2, "log lines dropped");
    assert_eq!(rows[0].3["count"], 3);
    assert_eq!(rows[1].2, "tick");
}

#[sqlx::test(migrations = "../migrations")]
async fn shutdown_flushes_what_is_queued(pool: PgPool) {
    let (_g, writer) = install(100);
    let handle = writer.spawn(pool.clone());
    tracing::info!(target: "gripsou_api", "listening");
    handle.shutdown().await;
    assert_eq!(saved(&pool).await.len(), 1);
}

#[sqlx::test(migrations = "../migrations")]
async fn a_nul_in_a_field_or_the_message_does_not_lose_the_batch(pool: PgPool) {
    let (_g, mut writer) = install(100);
    let span = tracing::info_span!(target: "gripsou_jobs", "sync", connection_id = "c\0span");
    span.in_scope(|| {
        tracing::info!(target: "gripsou_jobs", "before");
        let bad = "bad\0value";
        tracing::warn!(target: "gripsou_jobs", error = %bad, reason = "r\0s", "price {}", "fetch\0failed");
        tracing::info!(target: "gripsou_jobs", "after");
    });
    assert_eq!(writer.flush(&pool).await, 3);
    let rows = saved(&pool).await;
    assert_eq!(rows.len(), 3);
    let (_, _, message, fields) = &rows[1];
    assert_eq!(message, "price fetchfailed");
    assert_eq!(fields["error"], "badvalue");
    assert_eq!(fields["reason"], "rs");
    assert_eq!(fields["connection_id"], "cspan");
}
