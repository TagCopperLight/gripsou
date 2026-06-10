mod common;

use common::{checking_account, deposit_txn, seed_connection};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::transaction::insert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn inserts_once_and_dedups(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");
    let txn = deposit_txn("acct-1", "txn-1", Decimal::new(5000, 2));

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &acct).await?;

    let first = insert_transaction(&mut conn, account_id, &txn).await?;
    let second = insert_transaction(&mut conn, account_id, &txn).await?;
    assert!(first, "first insert reports inserted");
    assert!(!second, "duplicate external_id is skipped");

    let count: i64 = sqlx::query_scalar("select count(*) from transaction where account_id = $1")
        .bind(account_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 1);
    Ok(())
}
