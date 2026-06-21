//! Integration tests for `gripsou_jobs::request_sync`.
//!
//! Env-isolation note: Cargo runs integration tests within a single process and
//! env vars are process-global.
//!
//! - `request_sync_direct_path_marks_syncing` uses a custom provider key
//!   ('no-adapter') that has no entry in `account_providers()`, so it takes the
//!   direct path deterministically without touching any POWENS_* vars.
//! - `request_sync_webhook_path_marks_awaiting` sets the full POWENS_* set and
//!   asserts the *synchronous* status transition (`begin_await` commits before
//!   the spawn fires). The spawned `do_request_refresh` will fail (fake domain
//!   has no server) and may race to call `mark_synced_error`; in practice the
//!   status check runs before the HTTP call resolves, but this is not
//!   guaranteed. If this test ever flips to 'error', that is the documented
//!   race — see task-5-report.md.

use sqlx::PgPool;
use uuid::Uuid;

/// Encrypt `creds` using the given hex key and return the blob stored in the DB.
fn make_encrypted_creds(key_hex: &str, creds: serde_json::Value) -> serde_json::Value {
    let plaintext = serde_json::to_vec(&creds).unwrap();
    let ct = gripsou_core::crypto::encrypt(key_hex, &plaintext).unwrap();
    serde_json::json!({ "v": 1, "ct": ct })
}

/// Insert a user, returning the user_id.
async fn seed_user(pool: &PgPool) -> Uuid {
    let user_id = Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'Test', 'x')")
        .bind(user_id)
        .bind(format!("u-{user_id}@test.local"))
        .execute(pool)
        .await
        .unwrap();
    user_id
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

/// Insert a provider with the given key (for tests needing a custom provider key).
async fn seed_provider(pool: &PgPool, key: &str) {
    sqlx::query(
        "insert into provider (key, display_name, kind, enabled) \
         values ($1, $1, 'account', true) on conflict (key) do nothing",
    )
    .bind(key)
    .execute(pool)
    .await
    .unwrap();
}

// ── direct path ──────────────────────────────────────────────────────────────

/// When the connection's provider has no registered adapter, request_sync takes
/// the direct path (webhook=false): status becomes 'syncing' synchronously.
///
/// Uses a custom provider key ('no-adapter') that does not match any entry in
/// `account_providers()`, so the result is deterministic regardless of which
/// POWENS_* env vars happen to be set by other tests running concurrently.
#[sqlx::test(migrations = "../migrations")]
async fn request_sync_direct_path_marks_syncing(pool: PgPool) -> anyhow::Result<()> {
    let enc_key = "a".repeat(64);
    // ENCRYPTION_KEY must be present (sync_connection reads it in the spawned task).
    unsafe { std::env::set_var("ENCRYPTION_KEY", &enc_key) };

    // Insert a provider that has no adapter — no POWENS_* vars needed.
    seed_provider(&pool, "no-adapter").await;

    let user_id = seed_user(&pool).await;
    let credentials = make_encrypted_creds(&enc_key, serde_json::json!({ "auth_token": "tok" }));
    let meta = serde_json::json!({ "external_connection_id": "42" });
    let conn_id = seed_connection(&pool, user_id, "no-adapter", credentials, meta).await;

    let result = gripsou_jobs::request_sync(pool.clone(), user_id, conn_id).await;
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
/// The spawned `do_request_refresh` will fail (fake POWENS_DOMAIN has no
/// server). The status assertion runs synchronously before the HTTP call
/// resolves; see module doc for the documented race window.
#[sqlx::test(migrations = "../migrations")]
async fn request_sync_webhook_path_marks_awaiting(pool: PgPool) -> anyhow::Result<()> {
    let enc_key = "b".repeat(64);

    // Set all vars required by PowensProvider::from_env() + the webhook secret.
    // Use a fake domain that cannot be reached so the spawn fails cleanly.
    unsafe {
        std::env::set_var("ENCRYPTION_KEY", &enc_key);
        std::env::set_var("POWENS_CLIENT_ID", "test-client");
        std::env::set_var("POWENS_CLIENT_SECRET", "test-secret");
        std::env::set_var("POWENS_DOMAIN", "127.0.0.1:0"); // unreachable
        std::env::set_var("POWENS_REDIRECT_URI", "https://gripsou.test/callback");
        std::env::set_var("POWENS_WEBHOOK_SECRET", "test-secret-webhook");
    }

    let user_id = seed_user(&pool).await;
    let credentials = make_encrypted_creds(&enc_key, serde_json::json!({ "auth_token": "tok" }));
    let meta = serde_json::json!({ "external_connection_id": "99" });
    let conn_id = seed_connection(&pool, user_id, "powens", credentials, meta).await;

    let result = gripsou_jobs::request_sync(pool.clone(), user_id, conn_id).await;
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
    let enc_key = "c".repeat(64);

    // Same POWENS_* env as the webhook test so the adapter is webhook-enabled.
    unsafe {
        std::env::set_var("ENCRYPTION_KEY", &enc_key);
        std::env::set_var("POWENS_CLIENT_ID", "test-client");
        std::env::set_var("POWENS_CLIENT_SECRET", "test-secret");
        std::env::set_var("POWENS_DOMAIN", "127.0.0.1:0"); // unreachable
        std::env::set_var("POWENS_REDIRECT_URI", "https://gripsou.test/callback");
        std::env::set_var("POWENS_WEBHOOK_SECRET", "test-secret-webhook");
    }

    let user_id = seed_user(&pool).await;
    let credentials = make_encrypted_creds(&enc_key, serde_json::json!({ "auth_token": "tok" }));
    // provider_meta has NO external_connection_id — mimics the incomplete OAuth callback.
    let meta = serde_json::json!({ "powens_user_id": "42" });
    let conn_id = seed_connection(&pool, user_id, "powens", credentials, meta).await;

    let result = gripsou_jobs::request_sync(pool.clone(), user_id, conn_id).await;
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
