mod common;

use gripsou_core::dto::{Allocation, Composition, InstrumentRef};
use gripsou_core::repo::instrument::{
    mark_symbol_unresolved, resolve_instrument, set_composition, set_resolved_symbol,
};
use sqlx::PgPool;
use uuid::Uuid;

async fn isin_instrument(pool: &PgPool, isin: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "insert into instrument (id, kind, isin, name, currency) values ($1,'equity',$2,'X','EUR')",
    )
    .bind(id)
    .bind(isin)
    .execute(pool)
    .await
    .unwrap();
    id
}

#[sqlx::test(migrations = "../migrations")]
async fn set_resolved_symbol_writes_meta_and_leaves_identity_alone(pool: PgPool) {
    let id = Uuid::new_v4();
    sqlx::query(
        "insert into instrument (id, kind, symbol, name, currency) \
         values ($1,'equity','PUST','Amundi Nasdaq','EUR')",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    let mut conn = pool.acquire().await.unwrap();

    set_resolved_symbol(&mut conn, id, "PUST.PA").await.unwrap();

    let (kind, symbol, meta): (String, Option<String>, serde_json::Value) =
        sqlx::query_as("select kind, symbol, meta from instrument where id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    // `(kind, symbol)` is the natural key the next sync looks this row up by.
    assert_eq!(kind, "equity", "kind is the provider's, untouched");
    assert_eq!(symbol.as_deref(), Some("PUST"), "symbol untouched");
    assert_eq!(meta["yahoo_symbol"].as_str(), Some("PUST.PA"));
}

#[sqlx::test(migrations = "../migrations")]
async fn set_resolved_symbol_leaves_cash_symbol_null(pool: PgPool) {
    let id = Uuid::new_v4();
    sqlx::query("insert into instrument (id, kind, name, currency) values ($1,'cash','CNY','CNY')")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();

    set_resolved_symbol(&mut conn, id, "CNYEUR=X")
        .await
        .unwrap();

    let (symbol, meta): (Option<String>, serde_json::Value) =
        sqlx::query_as("select symbol, meta from instrument where id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(symbol, None);
    assert_eq!(meta["yahoo_symbol"].as_str(), Some("CNYEUR=X"));
}

fn equity_ref(symbol: &str) -> InstrumentRef {
    InstrumentRef {
        kind: "equity".into(),
        symbol: Some(symbol.into()),
        isin: None,
        name: "Amundi Nasdaq".into(),
        currency: "EUR".into(),
    }
}

/// Regression: a symbol-only instrument must resolve to the SAME row on every
/// sync, whatever the price and composition passes have written since. When
/// those passes rewrote `symbol` and `kind`, the next sync missed the natural
/// key, inserted a second instrument and a second holding, and ingest's close
/// loop zeroed the original — destroying that position's history.
#[sqlx::test(migrations = "../migrations")]
async fn symbol_only_instrument_survives_resolution_and_composition(pool: PgPool) {
    let mut conn = pool.acquire().await.unwrap();
    let first = resolve_instrument(&mut conn, &equity_ref("PUST"))
        .await
        .unwrap();

    set_resolved_symbol(&mut conn, first, "PUST.PA")
        .await
        .unwrap();
    set_composition(
        &mut conn,
        first,
        &Composition {
            countries: vec![Allocation {
                name: "USA".into(),
                weight: 1.0,
            }],
            sectors: vec![],
        },
    )
    .await
    .unwrap();

    let second = resolve_instrument(&mut conn, &equity_ref("PUST"))
        .await
        .unwrap();

    assert_eq!(first, second, "same instrument, not a duplicate");
    let count: i64 = sqlx::query_scalar("select count(*) from instrument where symbol = 'PUST'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test(migrations = "../migrations")]
async fn mark_symbol_unresolved_writes_meta(pool: PgPool) {
    let id = isin_instrument(&pool, "FR0000121014").await;
    let mut conn = pool.acquire().await.unwrap();

    mark_symbol_unresolved(&mut conn, id).await.unwrap();

    let meta: serde_json::Value = sqlx::query_scalar("select meta from instrument where id = $1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(meta["yahoo_resolution"].as_str(), Some("unresolved"));
}
