mod common;

use common::{checking_account, seed_connection, txn};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::transaction::{TxnWrite, upsert_transaction};
use rust_decimal::Decimal;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn inserts_once_then_updates_in_place(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;

    let first = upsert_transaction(
        &mut conn,
        account_id,
        &txn(
            "acct-1",
            "txn-1",
            "deposit",
            Decimal::new(5000, 2),
            Some("SALAIRE"),
        ),
    )
    .await?;
    assert_eq!(first, TxnWrite::Inserted);

    // Powens corrects the row after the fact: same external_id, new amount.
    let second = upsert_transaction(
        &mut conn,
        account_id,
        &txn(
            "acct-1",
            "txn-1",
            "deposit",
            Decimal::new(7500, 2),
            Some("SALAIRE MARS"),
        ),
    )
    .await?;
    assert_eq!(
        second,
        TxnWrite::Updated,
        "same external_id must update, not skip"
    );

    let (count, amount, description): (i64, Decimal, Option<String>) = sqlx::query_as(
        "select count(*), max(amount), max(description) from transaction where account_id = $1",
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 1, "no duplicate row");
    assert_eq!(amount, Decimal::new(7500, 2), "provider wins on amount");
    assert_eq!(description.as_deref(), Some("SALAIRE MARS"));
    Ok(())
}

/// The canonical DTO still carries instrument/quantity/unit_price for a future
/// provider that reports orders, but `transaction` is the cash ledger now and
/// must not try to store them.
#[sqlx::test(migrations = "../migrations")]
async fn upsert_ignores_instrument_level_fields(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let mut t = txn(
        "acct-1",
        "t1",
        "buy",
        Decimal::new(-21053, 2),
        Some("ACHAT COMPTANT"),
    );
    t.quantity = Some(Decimal::new(2, 0));
    t.unit_price = Some(Decimal::new(10474, 2));

    upsert_transaction(&mut conn, account_id, &t).await?;

    let amount: Decimal =
        sqlx::query_scalar("select amount from transaction where external_id = 't1'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(amount, Decimal::new(-21053, 2));
    Ok(())
}
