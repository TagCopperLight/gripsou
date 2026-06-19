mod common;

use chrono::{TimeZone, Utc};
use gripsou_core::repo::price::{insert_price, latest_price_ts};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

async fn make_instrument(pool: &PgPool) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("insert into instrument (id, kind, name, currency) values ($1,'equity','X','EUR')")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    id
}

#[sqlx::test(migrations = "../migrations")]
async fn latest_price_ts_none_then_max(pool: PgPool) {
    let instrument = make_instrument(&pool).await;
    let mut conn = pool.acquire().await.unwrap();

    assert_eq!(latest_price_ts(&mut conn, instrument).await.unwrap(), None);

    let t1 = Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap();
    let t2 = Utc.with_ymd_and_hms(2026, 6, 3, 0, 0, 0).unwrap();
    insert_price(&mut conn, instrument, t1, Decimal::new(10, 0), "EUR").await.unwrap();
    insert_price(&mut conn, instrument, t2, Decimal::new(12, 0), "EUR").await.unwrap();

    assert_eq!(latest_price_ts(&mut conn, instrument).await.unwrap(), Some(t2));
}
