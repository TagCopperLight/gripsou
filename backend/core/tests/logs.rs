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
