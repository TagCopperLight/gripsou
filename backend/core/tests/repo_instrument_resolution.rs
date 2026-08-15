mod common;

use gripsou_core::repo::instrument::{mark_symbol_unresolved, set_resolved_symbol};
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
async fn set_resolved_symbol_writes_symbol_and_meta(pool: PgPool) {
    let id = isin_instrument(&pool, "FR0000121014").await;
    let mut conn = pool.acquire().await.unwrap();

    set_resolved_symbol(&mut conn, id, "MC.PA").await.unwrap();

    let (symbol, meta): (Option<String>, serde_json::Value) =
        sqlx::query_as("select symbol, meta from instrument where id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(symbol.as_deref(), Some("MC.PA"));
    assert_eq!(meta["yahoo_symbol"].as_str(), Some("MC.PA"));
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

    set_resolved_symbol(&mut conn, id, "CNYEUR=X").await.unwrap();

    let (symbol, meta): (Option<String>, serde_json::Value) =
        sqlx::query_as("select symbol, meta from instrument where id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(symbol, None);
    assert_eq!(meta["yahoo_symbol"].as_str(), Some("CNYEUR=X"));
}

#[sqlx::test(migrations = "../migrations")]
async fn set_resolved_symbol_swallows_unique_clash(pool: PgPool) {
    // Two instruments resolving to the same (kind, symbol).
    let a = isin_instrument(&pool, "FR0000121014").await;
    let b = isin_instrument(&pool, "FR0000120271").await;

    let mut conn = pool.acquire().await.unwrap();
    set_resolved_symbol(&mut conn, a, "MC.PA").await.unwrap();
    set_resolved_symbol(&mut conn, b, "MC.PA").await.unwrap(); // clash!

    // B should have symbol = null (clash swallowed), but meta written.
    let (symbol, meta): (Option<String>, serde_json::Value) =
        sqlx::query_as("select symbol, meta from instrument where id = $1")
            .bind(b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(symbol, None, "display symbol clash swallowed");
    assert_eq!(
        meta["yahoo_symbol"].as_str(),
        Some("MC.PA"),
        "meta source-of-truth still written"
    );
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
