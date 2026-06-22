mod common;

use common::{cash_holding, checking_account, equity_holding, seed_connection};
use gripsou_core::dto::{Institution, SyncResult};
use gripsou_core::ingest::ingest;
use gripsou_core::repo::query::price_eligible_instruments_for_connection;
use rust_decimal::Decimal;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn returns_only_nonzero_noncash(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let sync = SyncResult {
        institution: Institution::default(),
        accounts: vec![checking_account("acct-1")],
        holdings: vec![
            cash_holding("acct-1", Decimal::new(100, 0)),
            equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            ),
        ],
        transactions: vec![],
    };
    ingest(&pool, conn_id, &sync).await.unwrap();

    let rows = price_eligible_instruments_for_connection(&pool, conn_id)
        .await
        .unwrap();

    assert_eq!(rows.len(), 1, "cash excluded, equity included");
    assert_eq!(rows[0].kind, "equity");
    assert_eq!(rows[0].isin.as_deref(), Some("US0378331005"));
    assert!(rows[0].symbol.is_none(), "ISIN path stores symbol null");
}
