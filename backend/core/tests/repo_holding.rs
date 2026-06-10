mod common;

use common::{cash_holding, checking_account, seed_connection};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::holding::upsert_holding;
use gripsou_core::repo::instrument::resolve_instrument;
use rust_decimal::Decimal;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn upserts_holding_and_updates_quantity(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let h1 = cash_holding("acct-1", Decimal::new(100, 0));

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;
    let instrument_id = resolve_instrument(&mut conn, &h1.instrument).await?;

    let hid1 = upsert_holding(&mut conn, account_id, instrument_id, &h1).await?;

    // Re-sync with a new quantity.
    let h2 = cash_holding("acct-1", Decimal::new(250, 0));
    let hid2 = upsert_holding(&mut conn, account_id, instrument_id, &h2).await?;
    assert_eq!(hid1, hid2, "same (account, instrument) is one holding");

    let qty: Decimal = sqlx::query_scalar("select quantity from holding where id = $1")
        .bind(hid1)
        .fetch_one(&pool)
        .await?;
    assert_eq!(qty, Decimal::new(250, 0), "quantity updated in place");

    let cost_basis: Decimal = sqlx::query_scalar("select cost_basis from holding where id = $1")
        .bind(hid1)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        cost_basis,
        Decimal::new(250, 0),
        "cost_basis updated in place"
    );
    Ok(())
}
