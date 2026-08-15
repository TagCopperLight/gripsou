mod common;

use common::{cash_holding, checking_account, equity_holding, seed_connection};
use gripsou_core::dto::{Institution, SyncResult};
use gripsou_core::ingest::ingest;
use gripsou_core::price_sync::fetch_prices_for_connection;
use gripsou_core::provider::PriceProvider;
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

#[sqlx::test(migrations = "../migrations")]
async fn foreign_cash_is_price_eligible_but_pivot_cash_is_not(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut cny = cash_holding("acct-1", Decimal::new(1000, 0));
    cny.instrument.currency = "CNY".to_string();
    cny.instrument.name = "Yuan".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(50, 0)), cny],
            transactions: vec![],
        },
    )
    .await?;

    let rows = price_eligible_instruments_for_connection(&pool, conn_id).await?;
    let currencies: Vec<&str> = rows
        .iter()
        .filter(|r| r.kind == "cash")
        .map(|r| r.currency.as_str())
        .collect();
    assert_eq!(
        currencies,
        vec!["CNY"],
        "EUR is the pivot; it needs no rate"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn foreign_security_reaches_its_currencys_cash_instrument(
    pool: PgPool,
) -> anyhow::Result<()> {
    // A USD equity held in an otherwise EUR account never has a USD *cash*
    // position of its own. The eligibility query must still surface a USD
    // cash instrument so the FX rate can be fetched -- otherwise fx_asof
    // ('USD') is NULL forever and the holding's `invested` stays at zero.
    let conn_id = seed_connection(&pool).await;
    let mut usd_equity = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::new(3, 0),
        Decimal::new(450, 0),
        Some(Decimal::new(600, 0)),
    );
    usd_equity.instrument.currency = "USD".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            // No USD cash holding at all -- only the foreign security.
            holdings: vec![usd_equity],
            transactions: vec![],
        },
    )
    .await?;

    // fetch_prices_for_connection backfills the missing USD cash instrument
    // before running the eligibility query (that's the fix for the hole:
    // a foreign security never causes a cash instrument in its own currency
    // to exist on its own). No providers needed for that backfill step.
    let providers: Vec<Box<dyn PriceProvider>> = vec![];
    fetch_prices_for_connection(&pool, conn_id, &providers).await?;

    let rows = price_eligible_instruments_for_connection(&pool, conn_id).await?;
    let usd_cash = rows
        .iter()
        .find(|r| r.kind == "cash" && r.currency == "USD");
    let currencies: Vec<&str> = rows.iter().map(|r| r.currency.as_str()).collect();
    assert!(
        usd_cash.is_some(),
        "the USD cash instrument backing the equity's currency must be eligible \
         even though no USD cash was ever held: got currencies {currencies:?}"
    );
    Ok(())
}
