mod common;

use common::seed_connection;
use gripsou_core::repo::connection::{
    BeginSync, SYNC_LOCK_STALE_MINS, begin_await, begin_sync, clear_stale_syncing, insert_pending,
    mark_synced_error, mark_synced_ok,
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

#[sqlx::test(migrations = "../migrations")]
async fn delete_stale_pending_only_removes_old_pending(pool: PgPool) {
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
    // An old non-pending row must be left alone.
    let ok = insert_pending(&pool, user_id, "powens", "ok")
        .await
        .unwrap();
    sqlx::query!(
        "update connection set created_at=now() - interval '20 minutes' where id=$1",
        stale
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "update connection set status='ok', created_at=now() - interval '20 minutes' where id=$1",
        ok
    )
    .execute(&pool)
    .await
    .unwrap();

    let n = gripsou_core::repo::connection::delete_stale_pending(&pool, 10)
        .await
        .unwrap();
    assert_eq!(n, 1);

    let remaining: Vec<uuid::Uuid> =
        sqlx::query_scalar("select id from connection where user_id=$1")
            .bind(user_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(remaining.contains(&fresh) && remaining.contains(&ok) && !remaining.contains(&stale));
}

/// A process that dies mid-sync leaves `status='syncing'` with nobody to
/// release it. `begin_sync` must take a claim over once it is older than
/// `SYNC_LOCK_STALE_MINS`, otherwise the connection is wedged forever.
#[sqlx::test(migrations = "../migrations")]
async fn begin_sync_takes_over_a_stale_claim(pool: PgPool) -> anyhow::Result<()> {
    let conn = seed_connection(&pool).await;
    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection where id=$1")
        .bind(conn)
        .fetch_one(&pool)
        .await?;

    assert!(matches!(
        begin_sync(&pool, user_id, conn).await?,
        BeginSync::Started(_)
    ));
    // A fresh claim is still honoured.
    assert!(matches!(
        begin_sync(&pool, user_id, conn).await?,
        BeginSync::AlreadySyncing
    ));

    // Age the claim past the threshold.
    sqlx::query(
        "update connection set sync_started_at = now() - make_interval(mins => $2) where id=$1",
    )
    .bind(conn)
    .bind(SYNC_LOCK_STALE_MINS + 1)
    .execute(&pool)
    .await?;
    assert!(matches!(
        begin_sync(&pool, user_id, conn).await?,
        BeginSync::Started(_)
    ));

    // The takeover re-stamps, so the next caller is refused again.
    assert!(matches!(
        begin_sync(&pool, user_id, conn).await?,
        BeginSync::AlreadySyncing
    ));

    // A row stuck before migration 0027 has no stamp at all — also stale.
    sqlx::query("update connection set sync_started_at = null where id=$1")
        .bind(conn)
        .execute(&pool)
        .await?;
    assert!(matches!(
        begin_sync(&pool, user_id, conn).await?,
        BeginSync::Started(_)
    ));
    Ok(())
}

/// The reaper's sweep: only claims past the threshold are released, and they
/// land in 'error' so the user sees the sync did not finish.
#[sqlx::test(migrations = "../migrations")]
async fn clear_stale_syncing_only_releases_old_claims(pool: PgPool) -> anyhow::Result<()> {
    let user_id = uuid::Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'T', 'x')")
        .bind(user_id)
        .bind(format!("u-{user_id}@test.local"))
        .execute(&pool)
        .await?;
    let fresh = insert_pending(&pool, user_id, "powens", "fresh").await?;
    let stale = insert_pending(&pool, user_id, "powens", "stale").await?;
    let unstamped = insert_pending(&pool, user_id, "powens", "unstamped").await?;

    begin_sync(&pool, user_id, fresh).await?;
    begin_sync(&pool, user_id, stale).await?;
    sqlx::query(
        "update connection set sync_started_at = now() - make_interval(mins => $2) where id=$1",
    )
    .bind(stale)
    .bind(SYNC_LOCK_STALE_MINS + 1)
    .execute(&pool)
    .await?;
    sqlx::query("update connection set status='syncing', sync_started_at=null where id=$1")
        .bind(unstamped)
        .execute(&pool)
        .await?;

    let n = clear_stale_syncing(&pool, SYNC_LOCK_STALE_MINS).await?;
    assert_eq!(n, 2);

    let statuses: Vec<(uuid::Uuid, String, Option<String>)> =
        sqlx::query_as("select id, status, last_error from connection where user_id=$1")
            .bind(user_id)
            .fetch_all(&pool)
            .await?;
    for (id, status, last_error) in statuses {
        if id == fresh {
            assert_eq!(status, "syncing");
            assert!(last_error.is_none());
        } else {
            assert_eq!(status, "error", "connection {id}");
            assert!(last_error.is_some_and(|e| e.contains("interrupted")));
        }
    }
    Ok(())
}

/// Releasing the lock must clear the stamp too, or the next sweep would judge
/// staleness from a claim that is no longer held.
#[sqlx::test(migrations = "../migrations")]
async fn finishing_a_sync_clears_the_claim_stamp(pool: PgPool) -> anyhow::Result<()> {
    let conn = seed_connection(&pool).await;
    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection where id=$1")
        .bind(conn)
        .fetch_one(&pool)
        .await?;

    begin_sync(&pool, user_id, conn).await?;
    let stamped: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("select sync_started_at from connection where id=$1")
            .bind(conn)
            .fetch_one(&pool)
            .await?;
    assert!(stamped.is_some());

    mark_synced_ok(&pool, conn).await?;
    let after_ok: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("select sync_started_at from connection where id=$1")
            .bind(conn)
            .fetch_one(&pool)
            .await?;
    assert!(after_ok.is_none());

    begin_sync(&pool, user_id, conn).await?;
    mark_synced_error(&pool, conn, "boom").await?;
    let after_err: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("select sync_started_at from connection where id=$1")
            .bind(conn)
            .fetch_one(&pool)
            .await?;
    assert!(after_err.is_none());
    Ok(())
}

/// Webhook providers request a sync through `begin_await`, so it must honour
/// the same stale-claim takeover — otherwise a wedged lock still blocks them.
#[sqlx::test(migrations = "../migrations")]
async fn begin_await_takes_over_a_stale_claim(pool: PgPool) -> anyhow::Result<()> {
    let conn = seed_connection(&pool).await;
    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection where id=$1")
        .bind(conn)
        .fetch_one(&pool)
        .await?;

    begin_sync(&pool, user_id, conn).await?;
    // A live claim still blocks it.
    assert!(matches!(
        begin_await(&pool, user_id, conn).await?,
        BeginSync::AlreadySyncing
    ));

    sqlx::query(
        "update connection set sync_started_at = now() - make_interval(mins => $2) where id=$1",
    )
    .bind(conn)
    .bind(SYNC_LOCK_STALE_MINS + 1)
    .execute(&pool)
    .await?;
    match begin_await(&pool, user_id, conn).await? {
        BeginSync::Started(s) => assert_eq!(s.status, "awaiting"),
        _ => panic!("expected Started"),
    }
    // The takeover left no stale stamp behind.
    let stamp: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("select sync_started_at from connection where id=$1")
            .bind(conn)
            .fetch_one(&pool)
            .await?;
    assert!(stamp.is_none());
    Ok(())
}
