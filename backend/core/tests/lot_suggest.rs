mod common;

use chrono::NaiveDate;
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::lot_suggest::suggest_lots;
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}
fn oct(d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
}

struct Fx {
    user: Uuid,
    account: Uuid,
    holding: Uuid,
}

/// A user with one account holding `held` shares of one ETF, priced 6.36 € on
/// every day of the test window.
async fn fixture(pool: &PgPool, held: &str) -> Fx {
    let (user, conn_id) = common::seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let account = upsert_account(&mut conn, conn_id, &common::checking_account("acct-1"))
        .await
        .unwrap();
    let holding = common::seed_equity_holding(pool, account, "ETF1", dec(held)).await;
    let instrument: Uuid = sqlx::query_scalar("select instrument_id from holding where id = $1")
        .bind(holding)
        .fetch_one(pool)
        .await
        .unwrap();
    for d in 1..=15 {
        common::insert_price_on(
            pool,
            instrument,
            oct(d).and_hms_opt(0, 0, 0).unwrap().and_utc(),
            dec("6.36"),
        )
        .await;
    }
    Fx {
        user,
        account,
        holding,
    }
}

async fn snap(pool: &PgPool, holding: Uuid, d: u32, qty: &str) {
    common::stamp_on(pool, holding, oct(d), dec(qty), Decimal::ZERO).await;
}

async fn txn(pool: &PgPool, account: Uuid, id: &str, kind: &str, amount: &str, d: u32) {
    let mut conn = pool.acquire().await.unwrap();
    upsert_transaction(
        &mut conn,
        account,
        &common::txn_on("acct-1", id, kind, dec(amount), oct(d)),
    )
    .await
    .unwrap();
}

async fn lot(pool: &PgPool, holding: Uuid, side: &str, on: NaiveDate, qty: &str) {
    sqlx::query(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, source) \
         values ($1, $2, $3, $4, 5, 'manual')",
    )
    .bind(holding)
    .bind(side)
    .bind(on)
    .bind(dec(qty))
    .execute(pool)
    .await
    .unwrap();
}

/// 60 shares explained by an old lot, 83 held since Oct 8.
async fn bought_23(pool: &PgPool) -> Fx {
    let fx = fixture(pool, "83").await;
    lot(
        pool,
        fx.holding,
        "buy",
        NaiveDate::from_ymd_opt(2025, 6, 4).unwrap(),
        "60",
    )
    .await;
    snap(pool, fx.holding, 4, "60").await;
    snap(pool, fx.holding, 8, "83").await;
    fx
}

#[sqlx::test(migrations = "../migrations")]
async fn a_rise_with_one_matching_buy_is_suggested(pool: PgPool) {
    let fx = bought_23(&pool).await;
    txn(&pool, fx.account, "t1", "buy", "-146.17", 8).await;

    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].side, "buy");
    assert_eq!(got[0].date, oct(8));
    assert_eq!(got[0].quantity, dec("23"));
    assert_eq!(got[0].unit_price, dec("6.35521739"));
    assert_eq!(got[0].fee, Decimal::ZERO);
}

#[sqlx::test(migrations = "../migrations")]
async fn an_amount_six_percent_off_is_not_a_candidate(pool: PgPool) {
    let fx = bought_23(&pool).await;
    // 23 × 6.36 = 146.28; +6 % ≈ 155.06.
    txn(&pool, fx.account, "t1", "buy", "-155.10", 8).await;
    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert!(got.is_empty());
}

#[sqlx::test(migrations = "../migrations")]
async fn a_transaction_outside_the_window_is_not_a_candidate(pool: PgPool) {
    let fx = bought_23(&pool).await;
    // Window is [Oct 5, Oct 11].
    txn(&pool, fx.account, "t1", "buy", "-146.17", 12).await;
    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert!(got.is_empty());
}

#[sqlx::test(migrations = "../migrations")]
async fn the_wording_and_the_sign_do_not_matter(pool: PgPool) {
    let fx = bought_23(&pool).await;
    // A mirrored portfolio-account row: positive, typed as a sale.
    txn(&pool, fx.account, "t1", "sell", "146.17", 7).await;
    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].side, "buy");
    assert_eq!(got[0].date, oct(7));
}

#[sqlx::test(migrations = "../migrations")]
async fn two_matching_transactions_suggest_nothing(pool: PgPool) {
    let fx = bought_23(&pool).await;
    txn(&pool, fx.account, "t1", "buy", "-146.17", 8).await;
    txn(&pool, fx.account, "t2", "buy", "-146.00", 9).await;
    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert!(got.is_empty());
}

#[sqlx::test(migrations = "../migrations")]
async fn a_lot_of_the_same_side_in_the_window_covers_the_jump(pool: PgPool) {
    let fx = bought_23(&pool).await;
    txn(&pool, fx.account, "t1", "buy", "-146.17", 8).await;
    // The user already recorded it, with a corrected quantity.
    lot(&pool, fx.holding, "buy", oct(7), "22").await;
    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert!(got.is_empty());
}

#[sqlx::test(migrations = "../migrations")]
async fn a_new_holding_on_a_watched_account_rises_from_zero(pool: PgPool) {
    let fx = fixture(&pool, "23").await;
    // Another holding proves the account was synced on Oct 4.
    let other = common::seed_equity_holding(&pool, fx.account, "ETF2", dec("1")).await;
    snap(&pool, other, 4, "1").await;
    snap(&pool, fx.holding, 8, "23").await;
    txn(&pool, fx.account, "t1", "buy", "-146.17", 8).await;

    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].quantity, dec("23"));
}

#[sqlx::test(migrations = "../migrations")]
async fn a_holding_on_a_freshly_connected_account_gets_nothing(pool: PgPool) {
    let fx = fixture(&pool, "23").await;
    snap(&pool, fx.holding, 8, "23").await;
    txn(&pool, fx.account, "t1", "buy", "-146.17", 8).await;
    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert!(got.is_empty());
}

#[sqlx::test(migrations = "../migrations")]
async fn a_sale_down_to_zero_is_suggested(pool: PgPool) {
    let fx = fixture(&pool, "0").await;
    lot(
        &pool,
        fx.holding,
        "buy",
        NaiveDate::from_ymd_opt(2025, 6, 4).unwrap(),
        "10",
    )
    .await;
    snap(&pool, fx.holding, 4, "10").await;
    snap(&pool, fx.holding, 8, "0").await;
    txn(&pool, fx.account, "t1", "sell", "63.60", 8).await;

    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].side, "sell");
    assert_eq!(got[0].quantity, dec("10"));
    assert_eq!(got[0].unit_price, dec("6.36"));
}

#[sqlx::test(migrations = "../migrations")]
async fn a_fully_explained_holding_gets_nothing(pool: PgPool) {
    let fx = bought_23(&pool).await;
    txn(&pool, fx.account, "t1", "buy", "-146.17", 8).await;
    // Lots explain all 83 shares, dated outside the jump's window.
    lot(
        &pool,
        fx.holding,
        "buy",
        NaiveDate::from_ymd_opt(2025, 7, 1).unwrap(),
        "23",
    )
    .await;
    let got = suggest_lots(&pool, fx.user, fx.holding)
        .await
        .unwrap()
        .unwrap();
    assert!(got.is_empty());
}

#[sqlx::test(migrations = "../migrations")]
async fn another_users_holding_is_none(pool: PgPool) {
    let fx = bought_23(&pool).await;
    let (stranger, _) = common::seed_user_and_connection(&pool).await;
    assert!(
        suggest_lots(&pool, stranger, fx.holding)
            .await
            .unwrap()
            .is_none()
    );
}
