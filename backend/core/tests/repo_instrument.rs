mod common;

use gripsou_core::dto::InstrumentRef;
use gripsou_core::error::CoreError;
use gripsou_core::repo::instrument::resolve_instrument;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn resolves_cash_idempotently(pool: PgPool) -> anyhow::Result<()> {
    let eur = InstrumentRef {
        kind: "cash".into(),
        symbol: None,
        isin: None,
        name: "Euro".into(),
        currency: "EUR".into(),
    };
    let mut conn = pool.acquire().await?;
    let id1 = resolve_instrument(&mut conn, &eur).await?;
    let id2 = resolve_instrument(&mut conn, &eur).await?;
    assert_eq!(id1, id2, "same currency must resolve to one cash instrument");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn resolves_equity_by_isin(pool: PgPool) -> anyhow::Result<()> {
    let aapl = InstrumentRef {
        kind: "equity".into(),
        symbol: Some("AAPL".into()),
        isin: Some("US0378331005".into()),
        name: "Apple Inc.".into(),
        currency: "USD".into(),
    };
    let mut conn = pool.acquire().await?;
    let id1 = resolve_instrument(&mut conn, &aapl).await?;
    let id2 = resolve_instrument(&mut conn, &aapl).await?;
    assert_eq!(id1, id2);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn rejects_unidentifiable_security(pool: PgPool) -> anyhow::Result<()> {
    let bad = InstrumentRef {
        kind: "equity".into(),
        symbol: None,
        isin: None,
        name: "Mystery".into(),
        currency: "USD".into(),
    };
    let mut conn = pool.acquire().await?;
    let err = resolve_instrument(&mut conn, &bad).await.unwrap_err();
    assert!(matches!(err, CoreError::MissingInstrumentId { .. }));
    Ok(())
}
