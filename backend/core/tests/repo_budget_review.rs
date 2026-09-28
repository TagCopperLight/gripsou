mod common;

use common::{checking_account, seed_user_and_connection, txn};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::assign::set_category;
use gripsou_core::repo::budget::category::list_categories;
use gripsou_core::repo::budget::review::{ReviewWrite, accept, review_count, undo};
use gripsou_core::repo::query::{TransactionFilters, transaction_counts};
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

async fn ai_row(
    pool: &PgPool,
    conf: Option<Decimal>,
    with_category: bool,
) -> anyhow::Result<(Uuid, Uuid, Uuid)> {
    let (user_id, conn_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await?;
    let acct = upsert_account(&mut conn, conn_id, &checking_account("a")).await?;
    upsert_transaction(
        &mut conn,
        acct,
        &txn("a", "t0", "withdrawal", Decimal::new(-1000, 2), Some("X")),
    )
    .await?;
    let id: Uuid = sqlx::query_scalar("select id from transaction where external_id = 't0'")
        .fetch_one(pool)
        .await?;
    let groceries = list_categories(pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("groceries"))
        .unwrap()
        .id;
    sqlx::query("update transaction set budget_category_id = $2, category_source = 'ai', category_confidence = $3 where id = $1")
        .bind(id).bind(with_category.then_some(groceries)).bind(conf)
        .execute(pool).await?;
    Ok((user_id, id, groceries))
}

async fn state(pool: &PgPool, id: Uuid) -> (Option<Uuid>, Option<String>, Option<Decimal>, bool) {
    sqlx::query_as("select budget_category_id, category_source, category_confidence, category_reviewed_at is not null from transaction where id = $1")
        .bind(id).fetch_one(pool).await.unwrap()
}

#[sqlx::test(migrations = "../migrations")]
async fn accepting_keeps_the_guess_and_marks_it_reviewed(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, id, groceries) = ai_row(&pool, Some(Decimal::new(40, 2)), true).await?;
    assert!(matches!(
        accept(&pool, user_id, id).await?,
        ReviewWrite::Done
    ));
    assert_eq!(
        state(&pool, id).await,
        (
            Some(groceries),
            Some("ai".into()),
            Some(Decimal::new(40, 2)),
            true
        )
    );
    assert_eq!(review_count(&pool, user_id, Decimal::new(80, 2)).await?, 0);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_no_guess_row_cannot_be_accepted(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, id, _) = ai_row(&pool, None, false).await?;
    assert!(matches!(
        accept(&pool, user_id, id).await?,
        ReviewWrite::Refused
    ));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn another_users_row_is_not_found(pool: PgPool) -> anyhow::Result<()> {
    let (_, id, _) = ai_row(&pool, Some(Decimal::new(40, 2)), true).await?;
    let (stranger, _) = seed_user_and_connection(&pool).await;
    assert!(matches!(
        accept(&pool, stranger, id).await?,
        ReviewWrite::NotFound
    ));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn undo_after_accept_restores_the_pending_guess(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, id, groceries) = ai_row(&pool, Some(Decimal::new(40, 2)), true).await?;
    accept(&pool, user_id, id).await?;
    assert!(matches!(
        undo(
            &pool,
            user_id,
            id,
            Some(groceries),
            Some(Decimal::new(40, 2))
        )
        .await?,
        ReviewWrite::Done
    ));
    assert_eq!(
        state(&pool, id).await,
        (
            Some(groceries),
            Some("ai".into()),
            Some(Decimal::new(40, 2)),
            false
        )
    );
    assert_eq!(review_count(&pool, user_id, Decimal::new(80, 2)).await?, 1);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn undo_after_a_correction_restores_the_ai_guess(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, id, groceries) = ai_row(&pool, Some(Decimal::new(40, 2)), true).await?;
    let other = list_categories(&pool, user_id)
        .await?
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some("restaurants"))
        .unwrap()
        .id;
    set_category(&pool, user_id, id, Some(other)).await?;
    undo(
        &pool,
        user_id,
        id,
        Some(groceries),
        Some(Decimal::new(40, 2)),
    )
    .await?;
    assert_eq!(state(&pool, id).await.0, Some(groceries));
    assert_eq!(state(&pool, id).await.1.as_deref(), Some("ai"));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn undo_refuses_a_category_that_is_not_the_users(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, id, _) = ai_row(&pool, Some(Decimal::new(40, 2)), true).await?;
    accept(&pool, user_id, id).await?;
    let (_, _, strangers) = ai_row(&pool, None, true).await?;
    assert!(matches!(
        undo(&pool, user_id, id, Some(strangers), None).await?,
        ReviewWrite::Refused
    ));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn undo_refuses_a_pending_row(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, id, groceries) = ai_row(&pool, Some(Decimal::new(40, 2)), true).await?;
    assert!(matches!(
        undo(&pool, user_id, id, Some(groceries), None).await?,
        ReviewWrite::Refused
    ));
    Ok(())
}

/// Same threshold on both sides, and rows on both sides of it: a row at 75 %
/// is in the queue at 80 % and out of it at 70 %, so a count and a list
/// reading different thresholds, or different rules, would disagree here.
#[sqlx::test(migrations = "../migrations")]
async fn the_count_agrees_with_the_list_filter(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, first, groceries) = ai_row(&pool, Some(Decimal::new(40, 2)), true).await?;
    let acct: Uuid = sqlx::query_scalar("select account_id from transaction where id = $1")
        .bind(first)
        .fetch_one(&pool)
        .await?;
    let mut conn = pool.acquire().await?;
    for (ext, conf) in [("t1", 75), ("t2", 90), ("t3", 20)] {
        upsert_transaction(
            &mut conn,
            acct,
            &txn("a", ext, "withdrawal", Decimal::new(-500, 2), Some("Y")),
        )
        .await?;
        sqlx::query(
            "update transaction set budget_category_id = $2, category_source = 'ai', \
             category_confidence = $3 where external_id = $1",
        )
        .bind(ext)
        .bind(groceries)
        .bind(Decimal::new(conf, 2))
        .execute(&pool)
        .await?;
    }
    // Accepted: out of the queue whatever its confidence.
    sqlx::query("update transaction set category_reviewed_at = now() where external_id = 't3'")
        .execute(&pool)
        .await?;

    for (threshold, expected) in [(Decimal::new(70, 2), 1), (Decimal::new(80, 2), 2)] {
        let f = TransactionFilters {
            needs_review: true,
            include_transfers: true,
            review_threshold: threshold,
            ..TransactionFilters::unfiltered()
        };
        let listed = transaction_counts(&pool, user_id, &f).await?.matching;
        assert_eq!(listed, expected, "at {threshold}");
        assert_eq!(review_count(&pool, user_id, threshold).await?, listed);
    }
    Ok(())
}

/// Undo re-checks the row in the write itself: a row paired since it was
/// accepted stays a transfer rather than becoming half an AI guess.
#[sqlx::test(migrations = "../migrations")]
async fn undo_refuses_a_row_paired_since_it_was_accepted(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, id, groceries) = ai_row(&pool, Some(Decimal::new(40, 2)), true).await?;
    accept(&pool, user_id, id).await?;
    sqlx::query("update transaction set transfer_pair_id = id where id = $1")
        .bind(id)
        .execute(&pool)
        .await?;
    assert!(matches!(
        undo(&pool, user_id, id, Some(groceries), None).await?,
        ReviewWrite::Refused
    ));
    assert!(state(&pool, id).await.3, "still reviewed");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn another_user_can_neither_accept_nor_undo(pool: PgPool) -> anyhow::Result<()> {
    let (owner, id, groceries) = ai_row(&pool, Some(Decimal::new(40, 2)), true).await?;
    let (stranger, _) = seed_user_and_connection(&pool).await;
    assert!(matches!(
        accept(&pool, stranger, id).await?,
        ReviewWrite::NotFound
    ));
    accept(&pool, owner, id).await?;
    assert!(matches!(
        undo(&pool, stranger, id, None, None).await?,
        ReviewWrite::NotFound
    ));
    assert_eq!(state(&pool, id).await.0, Some(groceries));
    assert!(state(&pool, id).await.3, "still reviewed");
    Ok(())
}
