mod common;

use common::seed_connection;
use gripsou_core::repo::connection::{
    begin_sync, mark_synced_error, mark_synced_ok, BeginSync,
};
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn begin_sync_claims_once(pool: PgPool) -> anyhow::Result<()> {
    let conn = seed_connection(&pool).await;
    let user_id: uuid::Uuid =
        sqlx::query_scalar("select user_id from connection where id=$1")
            .bind(conn)
            .fetch_one(&pool)
            .await?;

    // First claim succeeds and flips to 'syncing'.
    match begin_sync(&pool, user_id, conn).await? {
        BeginSync::Started(s) => assert_eq!(s.status, "syncing"),
        _ => panic!("expected Started"),
    }
    // Second claim while syncing → AlreadySyncing.
    assert!(matches!(
        begin_sync(&pool, user_id, conn).await?,
        BeginSync::AlreadySyncing
    ));
    // Unknown id → NotFound.
    assert!(matches!(
        begin_sync(&pool, user_id, uuid::Uuid::new_v4()).await?,
        BeginSync::NotFound
    ));
    // Connection exists but is owned by a different user → NotFound (not AlreadySyncing).
    assert!(matches!(
        begin_sync(&pool, uuid::Uuid::new_v4(), conn).await?,
        BeginSync::NotFound
    ));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn mark_ok_and_error_set_fields(pool: PgPool) -> anyhow::Result<()> {
    let conn = seed_connection(&pool).await;

    mark_synced_error(&pool, conn, "boom").await?;
    let (status, err): (String, Option<String>) =
        sqlx::query_as("select status, last_error from connection where id=$1")
            .bind(conn)
            .fetch_one(&pool)
            .await?;
    assert_eq!(status, "error");
    assert_eq!(err.as_deref(), Some("boom"));

    mark_synced_ok(&pool, conn).await?;
    let (status, err, synced): (String, Option<String>, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as("select status, last_error, last_sync_at from connection where id=$1")
            .bind(conn)
            .fetch_one(&pool)
            .await?;
    assert_eq!(status, "ok");
    assert!(err.is_none());
    assert!(synced.is_some());
    Ok(())
}
