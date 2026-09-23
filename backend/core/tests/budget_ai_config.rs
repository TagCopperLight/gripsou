mod common;

use common::seed_user_and_connection;
use gripsou_core::repo::connection;
use gripsou_core::repo::prefs::{budget_ai_enabled, review_threshold};
use gripsou_core::repo::settings::{budget_ai, set_budget_ai};
use rust_decimal::Decimal;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn ai_is_off_until_an_admin_picks_a_provider(pool: PgPool) -> anyhow::Result<()> {
    let s = budget_ai(&pool).await?;
    assert_eq!(s.provider, None);
    assert_eq!(s.model, None);

    set_budget_ai(&pool, Some("gemini"), Some("gemini-3.5-flash-lite")).await?;
    let s = budget_ai(&pool).await?;
    assert_eq!(s.provider.as_deref(), Some("gemini"));
    assert_eq!(s.model.as_deref(), Some("gemini-3.5-flash-lite"));

    set_budget_ai(&pool, None, None).await?;
    assert_eq!(budget_ai(&pool).await?.provider, None);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn an_unknown_provider_is_rejected_by_the_schema(pool: PgPool) -> anyhow::Result<()> {
    assert!(set_budget_ai(&pool, Some("openai"), None).await.is_err());
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn threshold_and_opt_in_come_from_prefs(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, _) = seed_user_and_connection(&pool).await;
    assert_eq!(review_threshold(&pool, user_id).await?, Decimal::new(70, 2));
    assert!(!budget_ai_enabled(&pool, user_id).await?);

    sqlx::query(
        "update users set prefs = '{\"budgetAiEnabled\":true,\"budgetAiThreshold\":65}' where id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await?;
    assert_eq!(review_threshold(&pool, user_id).await?, Decimal::new(65, 2));
    assert!(budget_ai_enabled(&pool, user_id).await?);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_connection_knows_its_owner(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    assert_eq!(connection::user_id(&pool, conn_id).await?, Some(user_id));
    assert_eq!(
        connection::user_id(&pool, uuid::Uuid::new_v4()).await?,
        None
    );
    Ok(())
}
