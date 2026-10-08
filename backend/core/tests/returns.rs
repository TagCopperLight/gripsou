mod common;

use chrono::NaiveDate;
use common::{checking_account, seed_user_and_connection};
use gripsou_core::repo::account::upsert_account;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

fn day(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

async fn add_lot(
    pool: &PgPool,
    holding_id: Uuid,
    side: &str,
    on: &str,
    qty: &str,
    price: &str,
    fee: &str,
) {
    sqlx::query(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source) \
         values ($1, $2, $3, $4, $5, $6, 'manual')",
    )
    .bind(holding_id)
    .bind(side)
    .bind(day(on))
    .bind(dec(qty))
    .bind(dec(price))
    .bind(dec(fee))
    .execute(pool)
    .await
    .unwrap();
}

async fn add_dividend(pool: &PgPool, account_id: Uuid, on: &str, amount: &str) {
    sqlx::query(
        "insert into transaction (account_id, ts, booked_on, type, amount, external_id) \
         values ($1, $2, $2, 'dividend', $3, $4)",
    )
    .bind(account_id)
    .bind(day(on))
    .bind(dec(amount))
    .bind(format!("div-{on}"))
    .execute(pool)
    .await
    .unwrap();
}

/// A user with one EUR account holding `qty` shares; returns (user, account, holding).
async fn seed(pool: &PgPool, qty: &str) -> (Uuid, Uuid, Uuid) {
    let (user_id, conn_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(
        &mut conn,
        conn_id,
        &checking_account(&format!("acct-{user_id}")),
    )
    .await
    .unwrap();
    let holding_id = common::seed_equity_holding(pool, account_id, "FR0000000001", dec(qty)).await;
    (user_id, account_id, holding_id)
}

#[sqlx::test(migrations = "../migrations")]
async fn lots_become_signed_flows_with_fees(pool: PgPool) {
    let (user_id, account_id, holding_id) = seed(&pool, "1").await;
    add_lot(&pool, holding_id, "buy", "2025-01-10", "2", "100", "1").await;
    add_lot(&pool, holding_id, "sell", "2025-06-10", "1", "120", "1").await;

    let inputs = gripsou_core::repo::returns::load(&pool, user_id)
        .await
        .unwrap();

    let mut flows: Vec<_> = inputs
        .flows
        .iter()
        .map(|f| (f.holding_id, f.account_id, f.day, f.amount))
        .collect();
    flows.sort_by_key(|f| f.2);
    assert_eq!(
        flows,
        vec![
            (
                Some(holding_id),
                account_id,
                day("2025-01-10"),
                Some(dec("-201"))
            ),
            (
                Some(holding_id),
                account_id,
                day("2025-06-10"),
                Some(dec("119"))
            ),
        ]
    );
    let p = &inputs.positions;
    assert_eq!(p.len(), 1);
    assert!(p[0].complete, "2 bought − 1 sold = 1 held");
}

#[sqlx::test(migrations = "../migrations")]
async fn dividends_are_account_flows(pool: PgPool) {
    let (user_id, account_id, holding_id) = seed(&pool, "1").await;
    add_lot(&pool, holding_id, "buy", "2025-01-10", "1", "100", "0").await;
    add_dividend(&pool, account_id, "2025-05-02", "3.5").await;

    let inputs = gripsou_core::repo::returns::load(&pool, user_id)
        .await
        .unwrap();

    assert!(inputs.flows.iter().any(|f| f.holding_id.is_none()
        && f.account_id == account_id
        && f.day == day("2025-05-02")
        && f.amount == Some(dec("3.5"))));
}

#[sqlx::test(migrations = "../migrations")]
async fn unexplained_quantity_is_incomplete(pool: PgPool) {
    let (user_id, _, holding_id) = seed(&pool, "5").await;
    add_lot(&pool, holding_id, "buy", "2025-01-10", "2", "100", "0").await;

    let inputs = gripsou_core::repo::returns::load(&pool, user_id)
        .await
        .unwrap();

    assert_eq!(inputs.positions.len(), 1);
    assert!(!inputs.positions[0].complete);
}

#[sqlx::test(migrations = "../migrations")]
async fn sold_out_holdings_still_count(pool: PgPool) {
    let (user_id, _, holding_id) = seed(&pool, "0").await;
    add_lot(&pool, holding_id, "buy", "2025-01-10", "2", "100", "0").await;
    add_lot(&pool, holding_id, "sell", "2025-03-10", "2", "110", "0").await;

    let inputs = gripsou_core::repo::returns::load(&pool, user_id)
        .await
        .unwrap();

    assert_eq!(inputs.positions.len(), 1);
    let p = &inputs.positions[0];
    assert!(p.complete);
    assert_eq!((p.value, p.invested), (Decimal::ZERO, Decimal::ZERO));
    assert_eq!(inputs.flows.len(), 2);
}

#[sqlx::test(migrations = "../migrations")]
async fn other_users_data_is_not_loaded(pool: PgPool) {
    let (user_a, _, holding_a) = seed(&pool, "1").await;
    let (_, account_b, holding_b) = seed(&pool, "1").await;
    add_lot(&pool, holding_a, "buy", "2025-01-10", "1", "100", "0").await;
    add_lot(&pool, holding_b, "buy", "2025-01-10", "1", "999", "0").await;
    add_dividend(&pool, account_b, "2025-05-02", "7").await;

    let inputs = gripsou_core::repo::returns::load(&pool, user_a)
        .await
        .unwrap();

    assert_eq!(inputs.positions.len(), 1);
    assert_eq!(inputs.flows.len(), 1);
    assert_eq!(inputs.flows[0].amount, Some(dec("-100")));
}
