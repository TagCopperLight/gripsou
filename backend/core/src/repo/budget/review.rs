//! The review queue's writes: accept and undo.

use rust_decimal::Decimal;
use uuid::Uuid;

use crate::budget::vocab::CategorySource;
use crate::error::CoreError;

#[derive(Debug, PartialEq, Eq)]
pub enum ReviewWrite {
    Done,
    NotFound,
    Refused,
    BadConfidence,
}

/// Runs only after a scoped write matched nothing, so the common path is one statement.
async fn not_written(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
) -> Result<ReviewWrite, CoreError> {
    let owned = sqlx::query_scalar!(
        r#"
        select exists(select 1 from user_transactions($2) t where t.id = $1) as "e!"
        "#,
        txn_id,
        user_id
    )
    .fetch_one(pool)
    .await?;
    Ok(if owned {
        ReviewWrite::Refused
    } else {
        ReviewWrite::NotFound
    })
}

/// Only an unreviewed AI row with a category can be accepted; a "no guess" row can only be corrected.
pub async fn accept(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
) -> Result<ReviewWrite, CoreError> {
    let mut tx = crate::db::begin_user_writes(pool, user_id).await?;
    let n = sqlx::query!(
        r#"
        update transaction t set category_reviewed_at = now()
         where t.id = $1
           and t.id in (select id from user_transactions($2))
           and t.category_source = $3
           and t.budget_category_id is not null
           and t.category_reviewed_at is null
        "#,
        txn_id,
        user_id,
        CategorySource::Ai as CategorySource,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    tx.commit().await?;
    if n == 1 {
        Ok(ReviewWrite::Done)
    } else {
        not_written(pool, user_id, txn_id).await
    }
}

/// Only a reviewed row can be undone, never a paired one, and only into one of the user's categories.
/// The update checks the state itself, so a sync that pairs the row in between makes it match nothing
/// instead of turning half a transfer back into an AI guess.
pub async fn undo(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
    confidence: Option<Decimal>,
) -> Result<ReviewWrite, CoreError> {
    if confidence.is_some_and(|c| c < Decimal::ZERO || c > Decimal::ONE) {
        return Ok(ReviewWrite::BadConfidence);
    }
    let mut tx = crate::db::begin_user_writes(pool, user_id).await?;
    let n = sqlx::query!(
        r#"
        update transaction t
           set budget_category_id = $3,
               category_source = $5,
               category_confidence = $4,
               category_reviewed_at = null
         where t.id = $1
           and t.id in (select id from user_transactions($2))
           and t.category_reviewed_at is not null
           and t.category_source in ($5, $6)
           and t.transfer_pair_id is null
           and ($3::uuid is null
                or exists (select 1 from budget_category c
                            where c.id = $3 and c.user_id = $2))
        "#,
        txn_id,
        user_id,
        category_id,
        confidence,
        CategorySource::Ai as CategorySource,
        CategorySource::User as CategorySource,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    tx.commit().await?;
    if n == 1 {
        Ok(ReviewWrite::Done)
    } else {
        not_written(pool, user_id, txn_id).await
    }
}

/// Counts the list's own rows (`budget_transaction_rows`) with `needs_review`, so it matches the list under
/// the review filter.
pub async fn review_count(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    threshold: Decimal,
) -> Result<i64, CoreError> {
    Ok(sqlx::query_scalar!(
        r#"
        select count(*) as "n!"
        from budget_transaction_rows($1, $2)
        where needs_review
        "#,
        user_id,
        threshold
    )
    .fetch_one(pool)
    .await?)
}
