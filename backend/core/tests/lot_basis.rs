mod common;

use chrono::NaiveDate;
use common::{checking_account, seed_connection};
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
    quantity: &str,
    unit_price: &str,
    fee: &str,
) {
    sqlx::query(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source) \
         values ($1, $2, $3, $4, $5, $6, 'manual')",
    )
    .bind(holding_id)
    .bind(side)
    .bind(day(on))
    .bind(dec(quantity))
    .bind(dec(unit_price))
    .bind(dec(fee))
    .execute(pool)
    .await
    .unwrap();
}

async fn basis_on(
    pool: &PgPool,
    holding_id: Uuid,
    on: &str,
) -> (Decimal, Option<Decimal>, Decimal) {
    sqlx::query_as(
        "select basis, mean_price, realised from lot_basis(array[$1]::uuid[], array[$2]::date[])",
    )
    .bind(holding_id)
    .bind(day(on))
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Seed one equity holding whose provider-reported quantity and cost basis are
/// given, so the "lots explain it exactly" branch can be exercised either way.
async fn seed(pool: &PgPool, quantity: &str, cost_basis: &str) -> Uuid {
    let conn_id = seed_connection(pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = common::seed_equity_holding(pool, account_id, "PUST", dec(quantity)).await;
    sqlx::query("update holding set cost_basis = $2 where id = $1")
        .bind(holding_id)
        .bind(dec(cost_basis))
        .execute(pool)
        .await
        .unwrap();
    holding_id
}

/// The real PUST trade: 2 shares at 104,74 with a 1,05 fee. Fee-inclusive PRMP
/// must give 210,53 — reconciling to Powens' own ACHAT COMPTANT cash line.
#[sqlx::test(migrations = "../migrations")]
async fn fee_is_part_of_the_basis(pool: PgPool) {
    let h = seed(&pool, "2", "210.52").await;
    add_lot(&pool, h, "buy", "2026-06-01", "2", "104.74", "1.05").await;

    let (basis, mean_price, _) = basis_on(&pool, h, "2026-09-14").await;
    assert_eq!(basis, dec("210.53"));
    assert_eq!(mean_price, Some(dec("105.265")));
}

/// AUDIT.md D-1's headline case, which `assetSeries.ts` gets wrong today.
/// A sale must remove qty x mu from the basis, NEVER its proceeds — folding
/// realised P/L into the basis makes the invested line move with the market.
#[sqlx::test(migrations = "../migrations")]
async fn a_sale_removes_cost_not_proceeds(pool: PgPool) {
    let h = seed(&pool, "5", "500").await;
    add_lot(&pool, h, "buy", "2026-01-01", "10", "100", "0").await;
    add_lot(&pool, h, "sell", "2026-02-01", "5", "200", "0").await;

    let (basis, _, realised) = basis_on(&pool, h, "2026-09-14").await;
    assert_eq!(
        basis,
        dec("500"),
        "10 bought at 100, 5 sold: 5 x 100 remains"
    );
    assert_eq!(realised, dec("500"), "5 x (200 - 100)");
}

/// The basis walks backward through the lots: before the sale, all ten shares
/// are still held and the basis is the full 1000.
#[sqlx::test(migrations = "../migrations")]
async fn basis_walks_backward_through_the_lots(pool: PgPool) {
    let h = seed(&pool, "5", "500").await;
    add_lot(&pool, h, "buy", "2026-01-01", "10", "100", "0").await;
    add_lot(&pool, h, "sell", "2026-02-01", "5", "200", "0").await;

    let (before_buy, _, _) = basis_on(&pool, h, "2025-12-31").await;
    let (after_buy, _, r_after_buy) = basis_on(&pool, h, "2026-01-15").await;
    assert_eq!(before_buy, dec("0"));
    assert_eq!(after_buy, dec("1000"));
    assert_eq!(r_after_buy, dec("0"), "nothing is realised before the sale");
}

/// When the lots do NOT explain the position, the provider's figure anchors
/// today and the unexplained remainder is carried flat backward (spec §8.2).
#[sqlx::test(migrations = "../migrations")]
async fn partial_lots_anchor_on_the_provider_figure(pool: PgPool) {
    let h = seed(&pool, "10", "1200").await;
    add_lot(&pool, h, "buy", "2026-01-01", "4", "100", "0").await;

    let (today, _, _) = basis_on(&pool, h, "2026-09-14").await;
    let (before, _, _) = basis_on(&pool, h, "2025-12-31").await;
    assert_eq!(today, dec("1200"), "today anchors on holding.cost_basis");
    assert_eq!(
        before,
        dec("800"),
        "the 400 explained by the lot is walked off; 800 unexplained stays flat"
    );
}

/// No buys at all means no mean, so there is nothing to override with: the
/// provider's figure is used, flat.
#[sqlx::test(migrations = "../migrations")]
async fn no_lots_falls_back_to_the_provider_figure(pool: PgPool) {
    let h = seed(&pool, "10", "1200").await;

    let (today, mean_price, _) = basis_on(&pool, h, "2026-09-14").await;
    let (before, _, _) = basis_on(&pool, h, "2020-01-01").await;
    assert_eq!(today, dec("1200"));
    assert_eq!(before, dec("1200"));
    assert_eq!(
        mean_price, None,
        "no buy lots recorded is not the same as a mean of zero"
    );
}

/// mu is order-independent by construction: a buy recorded after a sell still
/// shifts the mean for that earlier sale. Documented, deliberate, and pinned so
/// nobody "fixes" it into a running average without changing the spec too.
#[sqlx::test(migrations = "../migrations")]
async fn mean_price_is_order_independent(pool: PgPool) {
    let a = seed(&pool, "15", "0").await;
    add_lot(&pool, a, "buy", "2026-01-01", "10", "20", "0").await;
    add_lot(&pool, a, "buy", "2026-03-01", "10", "30", "0").await;
    add_lot(&pool, a, "sell", "2026-02-01", "5", "35", "0").await;

    let (_, mean_price, _) = basis_on(&pool, a, "2026-09-14").await;
    assert_eq!(
        mean_price,
        Some(dec("25")),
        "(10x20 + 10x30) / 20, regardless of the sell's date"
    );
}
