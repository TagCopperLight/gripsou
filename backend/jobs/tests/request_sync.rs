//! Integration tests for `gripsou_jobs::request_sync`.
//!
//! `request_sync_webhook_path_marks_awaiting` asserts the *synchronous* status
//! transition (`begin_await` commits before the spawn fires). The spawned
//! `do_request_refresh` will fail (the adapter's server is unreachable) and may
//! race to call `mark_synced_error`; in practice the status check runs before
//! the HTTP call resolves, but this is not guaranteed.

use std::collections::HashMap;
use std::sync::Arc;

use gripsou_core::provider::AccountProvider;
use gripsou_core::testkit;
use gripsou_jobs::Deps;
use gripsou_providers::powens::PowensProvider;
use sqlx::PgPool;
use uuid::Uuid;

/// Deps with the given account adapters only.
fn deps(accounts: Vec<(&str, Box<dyn AccountProvider>)>) -> Arc<Deps> {
    let mut deps = Deps::from_env(testkit::encryption_key(), "EUR".into());
    deps.accounts = accounts
        .into_iter()
        .map(|(k, a)| (k.to_string(), a))
        .collect::<HashMap<_, _>>();
    Arc::new(deps)
}

/// A webhook-enabled Powens adapter whose server is unreachable.
fn powens_with_webhooks() -> Arc<Deps> {
    deps(vec![(
        "powens",
        Box::new(PowensProvider::for_test_with_secret(
            "http://127.0.0.1:1",
            "test-secret-webhook",
        )),
    )])
}

/// Encrypt `creds` with the test key and return the blob stored in the DB.
fn make_encrypted_creds(creds: serde_json::Value) -> serde_json::Value {
    let plaintext = serde_json::to_vec(&creds).unwrap();
    let ct = testkit::encryption_key().encrypt(&plaintext).unwrap();
    serde_json::json!({ "v": 1, "ct": ct })
}

/// Insert a connection in 'ok' status with encrypted credentials and provider_meta.
async fn seed_connection(
    pool: &PgPool,
    user_id: Uuid,
    provider_key: &str,
    credentials: serde_json::Value,
    provider_meta: serde_json::Value,
) -> Uuid {
    let conn_id = Uuid::new_v4();
    sqlx::query(
        "insert into connection \
         (id, user_id, provider_key, display_name, status, credentials, provider_meta) \
         values ($1,$2,$3,'Test bank','ok',$4,$5)",
    )
    .bind(conn_id)
    .bind(user_id)
    .bind(provider_key)
    .bind(credentials)
    .bind(provider_meta)
    .execute(pool)
    .await
    .unwrap();
    conn_id
}

// ── direct path ──────────────────────────────────────────────────────────────

/// When the connection's provider has no registered adapter, request_sync takes
/// the direct path (webhook=false): status becomes 'syncing' synchronously.
///
#[sqlx::test(migrations = "../migrations")]
async fn request_sync_direct_path_marks_syncing(pool: PgPool) -> anyhow::Result<()> {
    let user_id = testkit::seed_user(&pool).await;
    let credentials = make_encrypted_creds(serde_json::json!({ "auth_token": "tok" }));
    let meta = serde_json::json!({ "external_connection_id": "42" });
    let conn_id = seed_connection(&pool, user_id, "no-adapter", credentials, meta).await;

    let result = gripsou_jobs::request_sync(
        pool.clone(),
        &deps(vec![]),
        user_id,
        conn_id,
        gripsou_jobs::Trigger::Manual,
    )
    .await
    .unwrap();
    // Assert on the returned state synchronously captured before the spawn.
    if let gripsou_core::repo::connection::BeginSync::Started(state) = result {
        assert_eq!(
            state.status, "syncing",
            "direct path: status should be 'syncing'"
        );
    } else {
        panic!("expected Started on direct path");
    }

    Ok(())
}

// ── webhook path ─────────────────────────────────────────────────────────────

/// When a Powens adapter is configured with a webhook secret, request_sync takes
/// the webhook path: status becomes 'awaiting' and sync_requested_at is stamped.
///
/// The spawned `do_request_refresh` will fail (the adapter's server is
/// unreachable). The status assertion runs synchronously before the HTTP call
/// resolves; see module doc for the documented race window.
#[sqlx::test(migrations = "../migrations")]
async fn request_sync_webhook_path_marks_awaiting(pool: PgPool) -> anyhow::Result<()> {
    let user_id = testkit::seed_user(&pool).await;
    let credentials = make_encrypted_creds(serde_json::json!({ "auth_token": "tok" }));
    let meta = serde_json::json!({ "external_connection_id": "99" });
    let conn_id = seed_connection(&pool, user_id, "powens", credentials, meta).await;

    let result = gripsou_jobs::request_sync(
        pool.clone(),
        &powens_with_webhooks(),
        user_id,
        conn_id,
        gripsou_jobs::Trigger::Manual,
    )
    .await
    .unwrap();
    // Assert on the returned state synchronously captured before the spawn.
    if let gripsou_core::repo::connection::BeginSync::Started(state) = result {
        assert_eq!(
            state.status, "awaiting",
            "webhook path: status should be 'awaiting'"
        );
    } else {
        panic!("expected Started on webhook path");
    }

    // sync_requested_at is safe to re-query since mark_synced_error never writes it.
    let req_at: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("select sync_requested_at from connection where id=$1")
            .bind(conn_id)
            .fetch_one(&pool)
            .await?;
    assert!(
        req_at.is_some(),
        "sync_requested_at must be stamped on webhook path"
    );

    Ok(())
}

// ── webhook-enabled adapter but no external_connection_id ────────────────────

/// When a Powens adapter is configured (webhook-enabled) but the connection's
/// provider_meta lacks `external_connection_id`, request_sync must fall back to
/// the direct path (status 'syncing', not 'awaiting').
///
/// This covers the Powens OAuth flow that omits connection_id (documented in
/// `complete_connect_without_connection_id`).
#[sqlx::test(migrations = "../migrations")]
async fn request_sync_without_external_id_falls_back_to_direct(pool: PgPool) -> anyhow::Result<()> {
    let user_id = testkit::seed_user(&pool).await;
    let credentials = make_encrypted_creds(serde_json::json!({ "auth_token": "tok" }));
    // provider_meta has NO external_connection_id — mimics the incomplete OAuth callback.
    let meta = serde_json::json!({ "powens_user_id": "42" });
    let conn_id = seed_connection(&pool, user_id, "powens", credentials, meta).await;

    let result = gripsou_jobs::request_sync(
        pool.clone(),
        &powens_with_webhooks(),
        user_id,
        conn_id,
        gripsou_jobs::Trigger::Manual,
    )
    .await
    .unwrap();
    // Must take the DIRECT path → status 'syncing', not 'awaiting'.
    if let gripsou_core::repo::connection::BeginSync::Started(state) = result {
        assert_eq!(
            state.status, "syncing",
            "no external_connection_id: must fall back to direct path (status 'syncing')"
        );
    } else {
        panic!("expected Started on direct fallback path");
    }

    Ok(())
}

// ── database failure ─────────────────────────────────────────────────────────

/// A database that cannot answer is an Err (the handler turns it into a 500),
/// never a silent "not found".
#[sqlx::test(migrations = "../migrations")]
async fn request_sync_on_a_failing_database_is_an_error(pool: PgPool) -> anyhow::Result<()> {
    let user_id = testkit::seed_user(&pool).await;
    pool.close().await;

    let result = gripsou_jobs::request_sync(
        pool.clone(),
        &deps(vec![]),
        user_id,
        Uuid::new_v4(),
        gripsou_jobs::Trigger::Manual,
    )
    .await;
    assert!(result.is_err(), "expected Err on a closed pool");

    Ok(())
}
