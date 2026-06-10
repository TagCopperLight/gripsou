mod common;

use common::{checking_account, seed_connection};
use gripsou_core::repo::account::upsert_account;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn upserts_account_idempotently(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");

    let mut conn = pool.acquire().await?;
    let id1 = upsert_account(&mut conn, conn_id, &acct).await?;
    let id2 = upsert_account(&mut conn, conn_id, &acct).await?;
    assert_eq!(id1, id2, "same (connection, external_id) is one account");

    let count: i64 =
        sqlx::query_scalar("select count(*) from account where connection_id = $1")
            .bind(conn_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(count, 1);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn upsert_preserves_user_renamed_name(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let acct = checking_account("acct-1");

    let mut conn = pool.acquire().await?;
    let id = upsert_account(&mut conn, conn_id, &acct).await?;

    // Simulate a user rename.
    sqlx::query("update account set name = 'My nickname' where id = $1")
        .bind(id)
        .execute(&pool)
        .await?;

    // Re-sync with the provider's original name.
    upsert_account(&mut conn, conn_id, &acct).await?;

    let name: String = sqlx::query_scalar("select name from account where id = $1")
        .bind(id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(name, "My nickname", "re-sync must not clobber a user rename");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn upsert_updates_provider_fields_on_conflict(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut acct = checking_account("acct-1");

    let mut conn = pool.acquire().await?;
    let id = upsert_account(&mut conn, conn_id, &acct).await?;

    // Provider reports an updated currency + account type on the next sync.
    acct.currency = "USD".to_string();
    acct.type_key = "savings".to_string();
    upsert_account(&mut conn, conn_id, &acct).await?;

    let row: (String, String) =
        sqlx::query_as("select currency, type_key from account where id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        row,
        ("USD".to_string(), "savings".to_string()),
        "provider-derived fields are updated on re-sync"
    );
    Ok(())
}
