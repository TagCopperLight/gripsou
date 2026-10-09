//! The `sync finished` line is what sync history reads (CLAUDE.md "Logs").
//! These tests pin its shape: one per sync, with the agreed fields.

use std::collections::HashMap;

use async_trait::async_trait;
use gripsou_core::dto::{Composition, InstrumentRef, SyncResult};
use gripsou_core::provider::{
    AccountProvider, CompleteConnect, CompositionProvider, ConnectInit, ProviderError,
};
use gripsou_jobs::{SyncDeps, Trigger};
use serde_json::Value;
use sqlx::PgPool;
use tracing::Instrument;
use uuid::Uuid;

const KEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

#[derive(Clone, Copy)]
enum Mode {
    Ok,
    Fail,
    Panic,
}

struct FakeBank {
    mode: Mode,
}

#[async_trait]
impl AccountProvider for FakeBank {
    fn key(&self) -> &str {
        "fake"
    }
    async fn connect(&self) -> Result<ConnectInit, ProviderError> {
        Err(ProviderError::NotImplemented)
    }
    async fn complete_connect(&self, _: &str) -> Result<CompleteConnect, ProviderError> {
        Err(ProviderError::NotImplemented)
    }
    async fn sync(&self, _: &Value) -> Result<SyncResult, ProviderError> {
        match self.mode {
            Mode::Ok => Ok(SyncResult::default()),
            Mode::Fail => Err(ProviderError::Other(
                "GET /accounts failed: 503 Service Unavailable".into(),
            )),
            Mode::Panic => panic!("adapter bug"),
        }
    }
}

struct NoComposition;

#[async_trait]
impl CompositionProvider for NoComposition {
    fn key(&self) -> &str {
        "none"
    }
    async fn resolve_symbol(&self, _: &InstrumentRef) -> Result<Option<String>, ProviderError> {
        Ok(None)
    }
    async fn fetch_composition(&self, _: &str) -> Result<Composition, ProviderError> {
        Ok(Composition::default())
    }
}

fn deps(mode: Mode) -> SyncDeps {
    let mut accounts: HashMap<String, Box<dyn AccountProvider>> = HashMap::new();
    accounts.insert("fake".into(), Box::new(FakeBank { mode }));
    SyncDeps {
        accounts,
        prices: Vec::new(),
        composition: Box::new(NoComposition),
    }
}

async fn seed(pool: &PgPool) -> (Uuid, Uuid) {
    unsafe { std::env::set_var("ENCRYPTION_KEY", KEY) };
    sqlx::query("insert into provider (key, display_name, kind, enabled) values ('fake','fake','account',true) on conflict (key) do nothing")
        .execute(pool).await.unwrap();
    let user: Uuid = sqlx::query_scalar(
        "insert into users (email, name, password_hash) values (gen_random_uuid()::text || '@t', 'T', 'x') returning id",
    ).fetch_one(pool).await.unwrap();
    let ct = gripsou_core::crypto::encrypt(KEY, br#"{"auth_token":"tok"}"#).unwrap();
    let conn: Uuid = sqlx::query_scalar(
        "insert into connection (user_id, provider_key, display_name, status, credentials, provider_meta) \
         values ($1, 'fake', 'Test bank', 'ok', $2, '{}') returning id",
    ).bind(user).bind(serde_json::json!({ "v": 1, "ct": ct }))
    .fetch_one(pool).await.unwrap();
    (user, conn)
}

async fn finished_lines(pool: &PgPool) -> Vec<(String, Value)> {
    sqlx::query_as("select level, fields from log where message = 'sync finished' order by id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn a_successful_sync_logs_one_sync_finished_with_its_counts(pool: PgPool) {
    let (_g, mut writer) = gripsou_core::logs::capture(1000);
    let (user, conn) = seed(&pool).await;
    gripsou_core::repo::connection::begin_sync(&pool, user, conn)
        .await
        .unwrap();

    let ok = gripsou_jobs::sync_connection_data_with(pool.clone(), conn, deps(Mode::Ok))
        .instrument(gripsou_jobs::sync_span(user, conn, Trigger::Manual))
        .await;
    assert!(ok);
    writer.flush(&pool).await;

    let lines = finished_lines(&pool).await;
    assert_eq!(lines.len(), 1, "exactly one sync finished per sync");
    let (level, f) = &lines[0];
    assert_eq!(level, "info");
    assert_eq!(f["outcome"], "ok");
    assert_eq!(f["trigger"], "manual");
    assert_eq!(f["provider"], "fake");
    assert_eq!(f["connection_id"], conn.to_string());
    assert_eq!(f["user_id"], user.to_string());
    assert!(f["sync_id"].is_string());
    assert!(f["duration_ms"].is_u64());
    for k in [
        "accounts",
        "holdings",
        "transactions_inserted",
        "transactions_updated",
        "holdings_closed",
        "transfers_paired",
    ] {
        assert!(f[k].is_u64(), "missing count {k}");
    }
    let started: i64 = sqlx::query_scalar(
        "select count(*) from log where message = 'sync started' and fields->>'sync_id' = $1",
    )
    .bind(f["sync_id"].as_str().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(started, 1);
}

#[sqlx::test(migrations = "../migrations")]
async fn a_failed_sync_logs_one_sync_finished_with_the_step_and_error(pool: PgPool) {
    let (_g, mut writer) = gripsou_core::logs::capture(1000);
    let (user, conn) = seed(&pool).await;
    gripsou_core::repo::connection::begin_sync(&pool, user, conn)
        .await
        .unwrap();

    let ok = gripsou_jobs::sync_connection_data_with(pool.clone(), conn, deps(Mode::Fail))
        .instrument(gripsou_jobs::sync_span(user, conn, Trigger::Daily))
        .await;
    assert!(!ok);
    writer.flush(&pool).await;

    let lines = finished_lines(&pool).await;
    assert_eq!(lines.len(), 1);
    let (level, f) = &lines[0];
    assert_eq!(level, "error");
    assert_eq!(f["outcome"], "failed");
    assert_eq!(f["failed_step"], "provider_fetch");
    assert!(f["error"].as_str().unwrap().contains("503"));
    assert_eq!(f["trigger"], "daily");
    assert!(f["duration_ms"].is_u64());
    // The failure is logged once, as sync finished: no separate error line.
    let errors: i64 = sqlx::query_scalar("select count(*) from log where level = 'error'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(errors, 1);
}

#[sqlx::test(migrations = "../migrations")]
async fn a_panicking_sync_logs_one_sync_finished_and_frees_the_lock(pool: PgPool) {
    let (_g, mut writer) = gripsou_core::logs::capture(1000);
    let (user, conn) = seed(&pool).await;
    gripsou_core::repo::connection::begin_sync(&pool, user, conn)
        .await
        .unwrap();

    let ok = gripsou_jobs::sync_connection_data_with(pool.clone(), conn, deps(Mode::Panic))
        .instrument(gripsou_jobs::sync_span(user, conn, Trigger::Manual))
        .await;
    assert!(!ok);
    writer.flush(&pool).await;

    let lines = finished_lines(&pool).await;
    assert_eq!(lines.len(), 1, "exactly one sync finished, even on a panic");
    let (level, f) = &lines[0];
    assert_eq!(level, "error");
    assert_eq!(f["outcome"], "failed");
    assert_eq!(f["failed_step"], "panic");
    assert!(f["error"].as_str().unwrap().contains("adapter bug"));
    assert_eq!(f["trigger"], "manual");
    assert_eq!(f["connection_id"], conn.to_string());
    assert!(f["duration_ms"].is_u64());

    // The lock is released now, not by the 30-minute stale-lock sweep.
    let status: String = sqlx::query_scalar("select status from connection where id = $1")
        .bind(conn)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(status, "syncing");
}

#[sqlx::test(migrations = "../migrations")]
async fn a_sync_that_cannot_start_logs_sync_skipped(pool: PgPool) {
    let (_g, mut writer) = gripsou_core::logs::capture(1000);
    let (user, conn) = seed(&pool).await;
    gripsou_core::repo::connection::begin_sync(&pool, user, conn)
        .await
        .unwrap();

    // Already syncing: the second request is refused and says why.
    let r = gripsou_jobs::request_sync(pool.clone(), user, conn, Trigger::Manual)
        .await
        .unwrap();
    assert!(matches!(
        r,
        gripsou_core::repo::connection::BeginSync::AlreadySyncing
    ));
    writer.flush(&pool).await;

    let f: Value = sqlx::query_scalar("select fields from log where message = 'sync skipped'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(f["reason"], "already_running");
    assert_eq!(f["trigger"], "manual");
    assert_eq!(f["connection_id"], conn.to_string());
}
