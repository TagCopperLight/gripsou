mod common;

use common::seed_connection;
use gripsou_core::repo::connection::{
    BeginSync, begin_sync, insert_pending, mark_synced_error, mark_synced_ok,
};
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn begin_sync_claims_once(pool: PgPool) -> anyhow::Result<()> {
    let conn = seed_connection(&pool).await;
    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection where id=$1")
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
    let (status, err, synced): (
        String,
        Option<String>,
        Option<chrono::DateTime<chrono::Utc>>,
    ) = sqlx::query_as("select status, last_error, last_sync_at from connection where id=$1")
        .bind(conn)
        .fetch_one(&pool)
        .await?;
    assert_eq!(status, "ok");
    assert!(err.is_none());
    assert!(synced.is_some());
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn insert_pending_creates_row(pool: PgPool) -> anyhow::Result<()> {
    let user_id = uuid::Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'T', 'x')")
        .bind(user_id)
        .bind(format!("u-{user_id}@test.local"))
        .execute(&pool)
        .await?;

    let id =
        gripsou_core::repo::connection::insert_pending(&pool, user_id, "powens", "My bank").await?;

    let (status,): (String,) = sqlx::query_as("select status from connection where id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(status, "pending");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn finish_connect_updates_credentials_and_status(pool: PgPool) -> anyhow::Result<()> {
    let user_id = uuid::Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'T', 'x')")
        .bind(user_id)
        .bind(format!("u-{user_id}@test.local"))
        .execute(&pool)
        .await?;

    let id =
        gripsou_core::repo::connection::insert_pending(&pool, user_id, "powens", "My bank").await?;

    let creds = serde_json::json!({"token": "abc"});
    let updated = gripsou_core::repo::connection::finish_connect(
        &pool,
        id,
        user_id,
        creds.clone(),
        serde_json::json!({}),
    )
    .await?;
    assert!(updated);

    let (status, stored_creds): (String, serde_json::Value) =
        sqlx::query_as("select status, credentials from connection where id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(status, "ok");
    assert_eq!(stored_creds, creds);

    // finish_connect with wrong user_id returns false
    let not_updated = gripsou_core::repo::connection::finish_connect(
        &pool,
        id,
        uuid::Uuid::new_v4(),
        serde_json::json!({}),
        serde_json::json!({}),
    )
    .await?;
    assert!(!not_updated);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn finish_connect_stores_provider_meta(pool: PgPool) -> anyhow::Result<()> {
    let user_id = uuid::Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'T', 'x')")
        .bind(user_id)
        .bind(format!("u-{user_id}@test.local"))
        .execute(&pool)
        .await?;

    let id =
        gripsou_core::repo::connection::insert_pending(&pool, user_id, "powens", "My bank").await?;

    let ok = gripsou_core::repo::connection::finish_connect(
        &pool,
        id,
        user_id,
        serde_json::json!({"auth_token": "x"}),
        serde_json::json!({"external_connection_id": "99"}),
    )
    .await
    .unwrap();
    assert!(ok);

    let meta = sqlx::query_scalar!(
        r#"select provider_meta as "m!" from connection where id=$1"#,
        id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(meta["external_connection_id"], "99");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn delete_connection_cascades(pool: PgPool) -> anyhow::Result<()> {
    let conn = common::seed_connection(&pool).await;
    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection where id=$1")
        .bind(conn)
        .fetch_one(&pool)
        .await?;

    // Wrong user — returns false, row still exists
    let not_deleted =
        gripsou_core::repo::connection::delete_connection(&pool, uuid::Uuid::new_v4(), conn)
            .await?;
    assert!(!not_deleted);

    // Correct user — returns true and row is gone
    let deleted = gripsou_core::repo::connection::delete_connection(&pool, user_id, conn).await?;
    assert!(deleted);

    let count: i64 = sqlx::query_scalar("select count(*) from connection where id=$1")
        .bind(conn)
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 0);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn awaiting_status_and_sync_requested_at_are_persistable(pool: PgPool) -> anyhow::Result<()> {
    let user_id = uuid::Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'T', 'x')")
        .bind(user_id)
        .bind(format!("u-{user_id}@test.local"))
        .execute(&pool)
        .await?;

    let id =
        gripsou_core::repo::connection::insert_pending(&pool, user_id, "powens", "Acme").await?;

    sqlx::query!(
        "update connection set status='awaiting', sync_requested_at=now() where id=$1",
        id
    )
    .execute(&pool)
    .await?;

    let row = sqlx::query!(
        r#"select status as "status!", sync_requested_at from connection where id=$1"#,
        id
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(row.status, "awaiting");
    assert!(row.sync_requested_at.is_some());
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn awaiting_timeout_selects_only_stale(pool: PgPool) {
    let user_id = uuid::Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'T', 'x')")
        .bind(user_id)
        .bind(format!("u-{user_id}@test.local"))
        .execute(&pool)
        .await
        .unwrap();
    let fresh = insert_pending(&pool, user_id, "powens", "fresh")
        .await
        .unwrap();
    let stale = insert_pending(&pool, user_id, "powens", "stale")
        .await
        .unwrap();
    sqlx::query!(
        "update connection set status='awaiting', sync_requested_at=now() where id=$1",
        fresh
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("update connection set status='awaiting', sync_requested_at=now() - interval '10 minutes' where id=$1", stale).execute(&pool).await.unwrap();
    let due = gripsou_core::repo::connection::connections_awaiting_timeout(&pool, 5)
        .await
        .unwrap();
    let ids: Vec<_> = due.iter().map(|c| c.id).collect();
    assert!(ids.contains(&stale) && !ids.contains(&fresh));
}
