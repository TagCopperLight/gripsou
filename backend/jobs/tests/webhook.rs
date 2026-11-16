use std::sync::Arc;

use base64::{Engine, engine::general_purpose::STANDARD};
use gripsou_core::provider::AccountProvider;
use gripsou_core::testkit;
use gripsou_jobs::Deps;
use gripsou_providers::powens::PowensProvider;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::PgPool;
use uuid::Uuid;

const WEBHOOK_SECRET: &str = "test-webhook-secret";

fn deps() -> Arc<Deps> {
    let deps = gripsou_jobs::testing::deps();
    let powens = PowensProvider::for_test_with_secret("http://127.0.0.1:1", WEBHOOK_SECRET);
    deps.set_accounts(
        [(
            "powens".to_string(),
            Arc::new(powens) as Arc<dyn AccountProvider>,
        )]
        .into(),
    );
    Arc::new(deps)
}

fn sign(secret: &str, path: &str, date: &str, body: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(format!("POST.{path}.{date}.{body}").as_bytes());
    STANDARD.encode(mac.finalize().into_bytes())
}

async fn seed_connection(pool: &PgPool, user_id: Uuid, ext_conn_id: &str) -> Uuid {
    let conn_id = Uuid::new_v4();
    let meta = serde_json::json!({ "external_connection_id": ext_conn_id });
    let credentials = gripsou_jobs::credentials::seal(
        &testkit::encryption_key(),
        &serde_json::json!({ "auth_token": "test" }),
    )
    .unwrap();
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

#[gripsou_core::testkit::db_test]
async fn handle_webhook_valid_claims_connection(pool: PgPool) -> anyhow::Result<()> {
    let user_id = testkit::seed_user(&pool).await;
    let conn_id = seed_connection(&pool, user_id, "99").await;

    let path = "/api/webhooks/powens";
    let date = "2024-01-15T10:00:00.000Z";
    let body = r#"{"connection":{"id":99}}"#;
    let sig = sign(WEBHOOK_SECRET, path, date, body);

    let mut headers = std::collections::HashMap::new();
    headers.insert("bi-signature-date".to_string(), date.to_string());
    headers.insert("bi-signature".to_string(), sig);

    let outcome = gripsou_jobs::handle_webhook(
        pool.clone(),
        &deps(),
        "powens",
        path,
        headers,
        body.as_bytes().to_vec(),
    )
    .await;

    assert!(
        matches!(outcome, gripsou_jobs::WebhookOutcome::Accepted),
        "expected Accepted for valid webhook"
    );

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

#[gripsou_core::testkit::db_test]
async fn handle_webhook_bad_signature_unauthorized(pool: PgPool) -> anyhow::Result<()> {
    let (_g, mut writer) = gripsou_core::logs::capture(100);
    let user_id = testkit::seed_user(&pool).await;
    let conn_id = seed_connection(&pool, user_id, "77").await;

    let path = "/api/webhooks/powens";
    let body = r#"{"connection":{"id":77}}"#;

    let mut headers = std::collections::HashMap::new();
    headers.insert(
        "bi-signature-date".to_string(),
        "2024-01-15T10:00:00.000Z".to_string(),
    );
    headers.insert(
        "bi-signature".to_string(),
        "bm90LXRoZS1yaWdodC1zaWc=".to_string(),
    );

    let outcome = gripsou_jobs::handle_webhook(
        pool.clone(),
        &deps(),
        "powens",
        path,
        headers,
        body.as_bytes().to_vec(),
    )
    .await;

    assert!(
        matches!(outcome, gripsou_jobs::WebhookOutcome::Unauthorized),
        "expected Unauthorized for bad signature"
    );

    writer.flush(&pool).await;
    let f: serde_json::Value =
        sqlx::query_scalar("select fields from log where message = 'webhook rejected'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(f["reason"], "bad_signature");
    assert!(
        f["error"]
            .as_str()
            .unwrap()
            .contains("bad webhook signature")
    );

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

#[gripsou_core::testkit::db_test]
async fn handle_webhook_unknown_connection_accepted(pool: PgPool) -> anyhow::Result<()> {
    let path = "/api/webhooks/powens";
    let date = "2024-01-15T10:00:00.000Z";
    let body = r#"{"connection":{"id":9999}}"#;
    let sig = sign(WEBHOOK_SECRET, path, date, body);

    let mut headers = std::collections::HashMap::new();
    headers.insert("bi-signature-date".to_string(), date.to_string());
    headers.insert("bi-signature".to_string(), sig);

    let outcome = gripsou_jobs::handle_webhook(
        pool.clone(),
        &deps(),
        "powens",
        path,
        headers,
        body.as_bytes().to_vec(),
    )
    .await;

    assert!(
        matches!(outcome, gripsou_jobs::WebhookOutcome::Accepted),
        "expected Accepted even when connection is unknown"
    );

    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn handle_webhook_refuses_a_disabled_provider(pool: PgPool) -> anyhow::Result<()> {
    let user_id = testkit::seed_user(&pool).await;
    let conn_id = seed_connection(&pool, user_id, "55").await;
    gripsou_core::repo::settings::set_provider_enabled(&pool, "powens", false).await?;

    let path = "/api/webhooks/powens";
    let date = "2024-01-15T10:00:00.000Z";
    let body = r#"{"connection":{"id":55}}"#;
    let mut headers = std::collections::HashMap::new();
    headers.insert("bi-signature-date".to_string(), date.to_string());
    headers.insert(
        "bi-signature".to_string(),
        sign(WEBHOOK_SECRET, path, date, body),
    );

    let outcome = gripsou_jobs::handle_webhook(
        pool.clone(),
        &deps(),
        "powens",
        path,
        headers,
        body.as_bytes().to_vec(),
    )
    .await;
    assert!(matches!(outcome, gripsou_jobs::WebhookOutcome::NotFound));
    let status: String = sqlx::query_scalar("select status from connection where id=$1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(status, "ok");
    Ok(())
}
