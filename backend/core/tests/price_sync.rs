mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use common::{checking_account, equity_holding, seed_connection};
use gripsou_core::dto::{InstrumentRef, PricePoint, SyncResult};
use gripsou_core::ingest::ingest;
use gripsou_core::price_sync::fetch_prices_for_connection;
use gripsou_core::provider::{PriceProvider, ProviderError};
use rust_decimal::Decimal;
use sqlx::PgPool;

struct MockProvider {
    symbol: Option<String>,
    fetch_calls: Arc<AtomicUsize>,
}

#[async_trait]
impl PriceProvider for MockProvider {
    fn key(&self) -> &str { "mock" }
    fn supports(&self, instrument: &InstrumentRef) -> bool { instrument.kind != "cash" }
    async fn resolve_symbol(&self, _i: &InstrumentRef) -> Result<Option<String>, ProviderError> {
        Ok(self.symbol.clone())
    }
    async fn fetch_prices(&self, _symbol: &str, _since: Option<chrono::DateTime<Utc>>)
        -> Result<Vec<PricePoint>, ProviderError> {
        self.fetch_calls.fetch_add(1, Ordering::SeqCst);
        Ok(vec![PricePoint { ts: Utc::now(), unit_price: Decimal::new(70000, 2), currency: "EUR".into() }])
    }
}

async fn seed_one_equity(pool: &PgPool) -> uuid::Uuid {
    let conn_id = seed_connection(pool).await;
    let sync = SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![equity_holding("acct-1", "US0378331005", Decimal::new(3, 0), Decimal::new(450, 0), Some(Decimal::new(600, 0)))],
        transactions: vec![],
    };
    ingest(pool, conn_id, &sync).await.unwrap();
    conn_id
}

fn price_count(pool: &PgPool) -> std::pin::Pin<Box<dyn std::future::Future<Output = i64> + Send + '_>> {
    Box::pin(async move {
        sqlx::query_scalar::<_, i64>("select count(*) from price").fetch_one(pool).await.unwrap()
    })
}

#[sqlx::test(migrations = "../migrations")]
async fn resolves_inserts_then_guard_skips(pool: PgPool) {
    let conn_id = seed_one_equity(&pool).await;
    let calls = Arc::new(AtomicUsize::new(0));
    let providers: Vec<Box<dyn PriceProvider>> =
        vec![Box::new(MockProvider { symbol: Some("MC.PA".into()), fetch_calls: calls.clone() })];

    let s1 = fetch_prices_for_connection(&pool, conn_id, &providers).await.unwrap();
    assert_eq!(s1.resolved, 1);
    assert_eq!(s1.prices_inserted, 1);
    assert_eq!(price_count(&pool).await, 1);

    // Display symbol populated.
    let symbol: Option<String> =
        sqlx::query_scalar("select symbol from instrument where isin = 'US0378331005'")
            .fetch_one(&pool).await.unwrap();
    assert_eq!(symbol.as_deref(), Some("MC.PA"));

    // Second pass: latest price is today → guard skips, fetch not called again.
    let s2 = fetch_prices_for_connection(&pool, conn_id, &providers).await.unwrap();
    assert_eq!(s2.skipped_fresh, 1);
    assert_eq!(calls.load(Ordering::SeqCst), 1, "fetch_prices called once total");
    assert_eq!(price_count(&pool).await, 1);
}

#[sqlx::test(migrations = "../migrations")]
async fn unresolved_marks_meta_and_inserts_nothing(pool: PgPool) {
    let conn_id = seed_one_equity(&pool).await;
    let calls = Arc::new(AtomicUsize::new(0));
    let providers: Vec<Box<dyn PriceProvider>> =
        vec![Box::new(MockProvider { symbol: None, fetch_calls: calls.clone() })];

    let s = fetch_prices_for_connection(&pool, conn_id, &providers).await.unwrap();
    assert_eq!(s.unresolved, 1);
    assert_eq!(s.prices_inserted, 0);
    assert_eq!(price_count(&pool).await, 0);
    assert_eq!(calls.load(Ordering::SeqCst), 0, "no fetch when unresolved");

    let meta: serde_json::Value =
        sqlx::query_scalar("select meta from instrument where isin = 'US0378331005'")
            .fetch_one(&pool).await.unwrap();
    assert_eq!(meta["yahoo_resolution"].as_str(), Some("unresolved"));
}
