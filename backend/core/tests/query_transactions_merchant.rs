mod common;

use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::memo::set_user_merchant;
use gripsou_core::repo::query::{TransactionFilters, transactions};
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../migrations")]
async fn every_row_sharing_a_description_carries_its_merchant(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let acct = upsert_account(&mut conn, conn_id, &checking_account("a")).await?;
    for (i, d) in ["CB LECLERC 0412", "CB LECLERC 0999", "SNCF"]
        .iter()
        .enumerate()
    {
        upsert_transaction(
            &mut conn,
            acct,
            &txn(
                "a",
                &format!("t{i}"),
                "withdrawal",
                Decimal::new(-100, 2),
                Some(d),
            ),
        )
        .await?;
    }
    let first: Uuid = sqlx::query_scalar("select id from transaction where external_id = 't0'")
        .fetch_one(&pool)
        .await?;
    set_user_merchant(&pool, user_id, first, Some("Leclerc"), Some("leclerc.fr")).await?;

    let rows = transactions(&pool, user_id, &TransactionFilters::unfiltered()).await?;
    let leclerc: Vec<_> = rows
        .iter()
        .filter(|r| r.description.as_deref().unwrap_or("").contains("LECLERC"))
        .collect();
    assert_eq!(leclerc.len(), 2);
    assert!(
        leclerc
            .iter()
            .all(|r| r.merchant_domain.as_deref() == Some("leclerc.fr"))
    );
    let sncf = rows
        .iter()
        .find(|r| r.description.as_deref() == Some("SNCF"))
        .unwrap();
    assert_eq!(sncf.merchant_domain, None);
    Ok(())
}
