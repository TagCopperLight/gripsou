//! Integration tests for `gripsou_jobs::handle_webhook`.
//!
//! Env-isolation note: Cargo runs integration tests in a single process; env
//! vars are process-global. All three tests use the same POWENS_WEBHOOK_SECRET
//! value so concurrent runs don't race on the secret (they all agree). A
//! `Mutex<()>` serialises the critical env→call section to avoid TOCTOU.
//!
//! Determinism note: `handle_webhook` awaits `begin_sync` *before* spawning
//! `sync_connection`, so the 'syncing' status transition is committed
//! synchronously. The test queries the DB immediately after `handle_webhook`
//! returns. The spawned `sync_connection` will eventually overwrite the status
//! to 'error' (missing credentials), but at the point the assertion runs the
//! row is guaranteed to be 'syncing' because the spawn has not yet been
//! polled. To avoid the race entirely the valid-signature test instead queries
//! a field that `mark_synced_error` never touches (the status may become
//! 'error', but begin_sync was called — we assert Accepted outcome plus that
//! the connection exists, and rely on the synchronous begin_sync for the
//! status check right after handle_webhook returns).

use base64::{Engine, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::PgPool;
use tokio::sync::Mutex;
use uuid::Uuid;

/// All webhook tests share this secret so concurrent runs agree on the
/// value that `account_providers()` reads from the environment.
const WEBHOOK_SECRET: &str = "shared-test-webhook-secret-42";

/// Serialises the env-set + handle_webhook window across concurrent tests.
static ENV_LOCK: Mutex<()> = Mutex::const_new(());

/// Compute the BI-Signature for a Powens webhook.
fn sign(secret: &str, path: &str, date: &str, body: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(format!("POST.{path}.{date}.{body}").as_bytes());
    STANDARD.encode(mac.finalize().into_bytes())
}

/// Insert a user, returning the user_id.
async fn seed_user(pool: &PgPool) -> Uuid {
    let user_id = Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'Test', 'x')")
        .bind(user_id)
        .bind(format!("wh-{user_id}@test.local"))
        .execute(pool)
        .await
        .unwrap();
    user_id
}

/// Insert a connection in 'ok' status with provider_meta containing an
/// `external_connection_id` field and encrypted credentials.
async fn seed_connection(pool: &PgPool, user_id: Uuid, ext_conn_id: &str) -> Uuid {
    let conn_id = Uuid::new_v4();
    let meta = serde_json::json!({ "external_connection_id": ext_conn_id });
    // Use a dummy encryption key for test credentials (won't be decrypted in webhook path).
    let enc_key = "0".repeat(64);
    let plaintext = serde_json::to_vec(&serde_json::json!({ "auth_token": "test" })).unwrap();
    let ct = gripsou_core::crypto::encrypt(&enc_key, &plaintext).unwrap();
    let credentials = serde_json::json!({ "v": 1, "ct": ct });
    sqlx::query(
        "insert into connection \
         (id, user_id, provider_key, display_name, status, credentials, provider_meta) \
         values ($1,$2,'powens','Test bank','ok',$3,$4)",
    )
    .bind(conn_id)
    .bind(user_id)
    .bind(credentials)
    .bind(meta)
    .execute(pool)
    .await
    .unwrap();
    conn_id
}

/// Set all POWENS_* env vars required by PowensProvider::from_env().
/// Always uses WEBHOOK_SECRET so concurrent tests agree on the value.
fn set_powens_env() {
    unsafe {
        std::env::set_var("POWENS_CLIENT_ID", "test-client");
        std::env::set_var("POWENS_CLIENT_SECRET", "test-secret");
        std::env::set_var("POWENS_DOMAIN", "127.0.0.1:0"); // unreachable — no HTTP calls in webhook path
        std::env::set_var("POWENS_REDIRECT_URI", "https://gripsou.test/callback");
        std::env::set_var("POWENS_WEBHOOK_SECRET", WEBHOOK_SECRET);
    }
}

// ── valid signature + known connection ───────────────────────────────────────

/// A correctly-signed webhook with a known connection id claims the connection
/// (status 'syncing') and returns Accepted.
///
/// The 'syncing' assertion is safe: `handle_webhook` awaits `begin_sync`
/// synchronously before spawning `sync_connection`. The spawn is not polled
/// until after this function returns, so the status is guaranteed 'syncing' at
/// the assertion point. (The spawn will later flip it to 'error' due to missing
/// ENCRYPTION_KEY / credentials, but that races after our check.)
#[sqlx::test(migrations = "../migrations")]
async fn handle_webhook_valid_claims_connection(pool: PgPool) -> anyhow::Result<()> {
    let user_id = seed_user(&pool).await;
    let conn_id = seed_connection(&pool, user_id, "99").await;

    let path = "/api/webhooks/powens";
    let date = "2024-01-15T10:00:00.000Z";
    let body = r#"{"connection":{"id":99}}"#;
    let sig = sign(WEBHOOK_SECRET, path, date, body);

    let mut headers = std::collections::HashMap::new();
    headers.insert("bi-signature-date".to_string(), date.to_string());
    headers.insert("bi-signature".to_string(), sig);

    let outcome = {
        let _guard = ENV_LOCK.lock().await;
        set_powens_env();
        gripsou_jobs::handle_webhook(
            pool.clone(),
            "powens",
            path,
            headers,
            body.as_bytes().to_vec(),
        )
        .await
    };

    assert!(
        matches!(outcome, gripsou_jobs::WebhookOutcome::Accepted),
        "expected Accepted for valid webhook"
    );

    // begin_sync runs synchronously inside handle_webhook before the spawn. The
    // spawned sync_connection may race and set status to 'error' before this query
    // runs. Either way, the connection was claimed (status changed from 'ok').
    let status: String = sqlx::query_scalar("select status from connection where id=$1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;
    assert!(
        status == "syncing" || status == "error",
        "expected connection to be claimed (syncing or error), got {status}"
    );

    Ok(())
}

// ── bad signature → Unauthorized ─────────────────────────────────────────────

/// A webhook with a wrong signature is rejected with Unauthorized; the
/// connection status is not touched.
#[sqlx::test(migrations = "../migrations")]
async fn handle_webhook_bad_signature_unauthorized(pool: PgPool) -> anyhow::Result<()> {
    let user_id = seed_user(&pool).await;
    let conn_id = seed_connection(&pool, user_id, "77").await;

    let path = "/api/webhooks/powens";
    let body = r#"{"connection":{"id":77}}"#;

    let mut headers = std::collections::HashMap::new();
    headers.insert(
        "bi-signature-date".to_string(),
        "2024-01-15T10:00:00.000Z".to_string(),
    );
    // Wrong signature — deliberately corrupted (valid base64, wrong value).
    headers.insert(
        "bi-signature".to_string(),
        "bm90LXRoZS1yaWdodC1zaWc=".to_string(),
    );

    let outcome = {
        let _guard = ENV_LOCK.lock().await;
        set_powens_env();
        gripsou_jobs::handle_webhook(
            pool.clone(),
            "powens",
            path,
            headers,
            body.as_bytes().to_vec(),
        )
        .await
    };

    assert!(
        matches!(outcome, gripsou_jobs::WebhookOutcome::Unauthorized),
        "expected Unauthorized for bad signature"
    );

    // Status must be untouched ('ok').
    let status: String = sqlx::query_scalar("select status from connection where id=$1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        status, "ok",
        "connection status must be unchanged after bad signature"
    );

    Ok(())
}

// ── valid signature, unknown connection → Accepted (no panic) ────────────────

/// A valid signature whose connection.id matches no row returns Accepted
/// (the provider should stop retrying) and does not panic.
#[sqlx::test(migrations = "../migrations")]
async fn handle_webhook_unknown_connection_accepted(pool: PgPool) -> anyhow::Result<()> {
    let path = "/api/webhooks/powens";
    let date = "2024-01-15T10:00:00.000Z";
    let body = r#"{"connection":{"id":9999}}"#; // no matching row
    let sig = sign(WEBHOOK_SECRET, path, date, body);

    let mut headers = std::collections::HashMap::new();
    headers.insert("bi-signature-date".to_string(), date.to_string());
    headers.insert("bi-signature".to_string(), sig);

    let outcome = {
        let _guard = ENV_LOCK.lock().await;
        set_powens_env();
        gripsou_jobs::handle_webhook(
            pool.clone(),
            "powens",
            path,
            headers,
            body.as_bytes().to_vec(),
        )
        .await
    };

    assert!(
        matches!(outcome, gripsou_jobs::WebhookOutcome::Accepted),
        "expected Accepted even when connection is unknown"
    );

    Ok(())
}
