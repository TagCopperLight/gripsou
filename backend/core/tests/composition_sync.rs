mod common;

use async_trait::async_trait;
use common::{checking_account, equity_holding, seed_connection};
use gripsou_core::composition_sync::fetch_composition_for_connection;
use gripsou_core::dto::{Allocation, Composition, Institution, InstrumentRef, SyncResult};
use gripsou_core::ingest::ingest;
use gripsou_core::provider::{CompositionProvider, ProviderError};
use rust_decimal::Decimal;
use sqlx::PgPool;

struct MockComp {
    symbol: Option<String>,
    comp: Composition,
}

fn nonempty_comp() -> Composition {
    Composition {
        countries: vec![Allocation {
            name: "USA".into(),
            weight: 0.6,
        }],
        sectors: vec![Allocation {
            name: "Tech".into(),
            weight: 0.4,
        }],
    }
}

#[async_trait]
impl CompositionProvider for MockComp {
    fn key(&self) -> &str {
        "mock"
    }
    async fn resolve_symbol(&self, _i: &InstrumentRef) -> Result<Option<String>, ProviderError> {
        Ok(self.symbol.clone())
    }
    async fn fetch_composition(&self, _s: &str) -> Result<Composition, ProviderError> {
        Ok(self.comp.clone())
    }
}

async fn seed_one_equity(pool: &PgPool) -> uuid::Uuid {
    let conn_id = seed_connection(pool).await;
    let sync = SyncResult {
        institution: Institution::default(),
        accounts: vec![checking_account("acct-1")],
        holdings: vec![equity_holding(
            "acct-1",
            "US0378331005",
            Decimal::new(3, 0),
            Decimal::new(450, 0),
            Some(Decimal::new(600, 0)),
        )],
        transactions: vec![],
    };
    ingest(pool, conn_id, &sync).await.unwrap();
    conn_id
}

#[sqlx::test(migrations = "../migrations")]
async fn stores_composition_and_sets_etf_kind(pool: PgPool) {
    let conn_id = seed_one_equity(&pool).await;

    let provider = MockComp {
        symbol: Some("1rTX".into()),
        comp: nonempty_comp(),
    };
    let summary = fetch_composition_for_connection(&pool, conn_id, &provider)
        .await
        .unwrap();
    assert_eq!(summary.resolved, 1);
    assert_eq!(summary.fetched, 1);

    let row = sqlx::query!(r#"select kind, meta from instrument where kind <> 'cash' limit 1"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.kind, "etf");
    assert_eq!(row.meta["composition"]["countries"][0]["name"], "USA");

    // Second run: row is now fresh (composition.as_of is today), so the
    // eligibility query excludes it.
    let again = fetch_composition_for_connection(&pool, conn_id, &provider)
        .await
        .unwrap();
    assert_eq!(
        again,
        gripsou_core::composition_sync::CompositionSyncSummary::default()
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn marks_none_when_no_tracker(pool: PgPool) {
    let conn_id = seed_one_equity(&pool).await;

    let provider = MockComp {
        symbol: None,
        comp: nonempty_comp(),
    };
    let summary = fetch_composition_for_connection(&pool, conn_id, &provider)
        .await
        .unwrap();
    assert_eq!(summary.unresolved, 1);

    // none-marked rows are excluded by the eligibility query on second run
    let again = fetch_composition_for_connection(&pool, conn_id, &provider)
        .await
        .unwrap();
    assert_eq!(
        again,
        gripsou_core::composition_sync::CompositionSyncSummary::default()
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn marks_none_when_composition_empty(pool: PgPool) {
    // Symbol resolves, but the page has no breakdown (e.g. an equity, or a
    // tracker that reports none) — must NOT be stamped `etf`.
    let conn_id = seed_one_equity(&pool).await;

    let provider = MockComp {
        symbol: Some("1rTX".into()),
        comp: Composition::default(),
    };
    let summary = fetch_composition_for_connection(&pool, conn_id, &provider)
        .await
        .unwrap();
    assert_eq!(summary.resolved, 1);
    assert_eq!(summary.fetched, 0);
    assert_eq!(summary.unresolved, 1);

    let row = sqlx::query!(r#"select kind, meta from instrument where kind <> 'cash' limit 1"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.kind, "equity");
    assert_eq!(row.meta["composition_status"], "none");
    assert!(row.meta.get("composition").is_none());
}
