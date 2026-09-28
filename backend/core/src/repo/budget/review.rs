//! The review queue's writes: accept and undo. The queue itself is the
//! transactions list with `needs_review`; nothing here lists rows.

use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

#[derive(Debug, PartialEq, Eq)]
pub enum ReviewWrite {
    Done,
    /// Not this user's row.
    NotFound,
    /// The row is not in a state this action applies to.
    Refused,
}

/// Tells a refused write apart from someone else's row. Runs only after a
/// scoped write matched nothing, so the common path is one statement.
async fn not_written(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
) -> Result<ReviewWrite, CoreError> {
    let owned = sqlx::query_scalar!(
        r#"
        select exists(
          select 1 from transaction t
          join account a on a.id = t.account_id
          join connection k on k.id = a.connection_id
          where t.id = $1 and k.user_id = $2) as "e!"
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

/// Keeps the AI's guess and marks it reviewed. Only an unreviewed AI row
/// that actually has a category can be accepted — a "no guess" row can only
/// be corrected.
pub async fn accept(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
) -> Result<ReviewWrite, CoreError> {
    let n = sqlx::query!(
        r#"
        update transaction t set category_reviewed_at = now()
          from account a
          join connection k on k.id = a.connection_id
         where t.id = $1 and a.id = t.account_id and k.user_id = $2
           and t.category_source = 'ai'
           and t.budget_category_id is not null
           and t.category_reviewed_at is null
        "#,
        txn_id,
        user_id
    )
    .execute(pool)
    .await?
    .rows_affected();
    if n == 1 {
        Ok(ReviewWrite::Done)
    } else {
        not_written(pool, user_id, txn_id).await
    }
}

/// Puts a resolved row back in the queue with the guess the client last
/// showed. Only a reviewed row (accepted, or corrected by the user) can be
/// undone, never a paired one, and only into one of the user's categories.
///
/// The state is checked by the update itself, not read beforehand: a sync
/// that pairs the row in between makes the update match nothing, rather than
/// turning half a transfer back into an AI guess. `confidence` is the
/// caller's to validate (0 to 1).
pub async fn undo(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
    confidence: Option<Decimal>,
) -> Result<ReviewWrite, CoreError> {
    let n = sqlx::query!(
        r#"
        update transaction t
           set budget_category_id = $3,
               category_source = 'ai',
               category_confidence = $4,
               category_reviewed_at = null
          from account a
          join connection k on k.id = a.connection_id
         where t.id = $1 and a.id = t.account_id and k.user_id = $2
           and t.category_reviewed_at is not null
           and t.category_source in ('ai', 'user')
           and t.transfer_pair_id is null
           and ($3::uuid is null
                or exists (select 1 from budget_category c
                            where c.id = $3 and c.user_id = $2))
        "#,
        txn_id,
        user_id,
        category_id,
        confidence,
    )
    .execute(pool)
    .await?
    .rows_affected();
    if n == 1 {
        Ok(ReviewWrite::Done)
    } else {
        not_written(pool, user_id, txn_id).await
    }
}

/// The queue's size — the amber segment and the banner. Counts the list's own
/// rows (`budget_transaction_rows`) with `needs_review`, so it is by
/// construction what the list shows under the review filter with transfers
/// included.
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
