//! The review queue's writes (phase 5 spec §5). The queue itself is the
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

/// Keeps the AI's guess and marks it reviewed. Only an unreviewed AI row
/// that actually has a category can be accepted — a "no guess" row can only
/// be corrected.
pub async fn accept(
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
    if !owned {
        return Ok(ReviewWrite::NotFound);
    }
    let n = sqlx::query!(
        r#"
        update transaction set category_reviewed_at = now()
         where id = $1
           and category_source = 'ai'
           and budget_category_id is not null
           and category_reviewed_at is null
        "#,
        txn_id
    )
    .execute(pool)
    .await?
    .rows_affected();
    Ok(if n == 1 {
        ReviewWrite::Done
    } else {
        ReviewWrite::Refused
    })
}

/// Puts a resolved row back in the queue with the guess the client last
/// showed. Only a reviewed row (accepted, or corrected by the user) can be
/// undone, never a paired one, and only into one of the user's categories.
pub async fn undo(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
    confidence: Option<Decimal>,
) -> Result<ReviewWrite, CoreError> {
    let row = sqlx::query!(
        r#"
        select t.category_source, t.category_reviewed_at, t.transfer_pair_id
        from transaction t
        join account a on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where t.id = $1 and k.user_id = $2
        "#,
        txn_id,
        user_id
    )
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(ReviewWrite::NotFound);
    };
    let reviewed = row.category_reviewed_at.is_some()
        && matches!(row.category_source.as_deref(), Some("ai") | Some("user"));
    if !reviewed || row.transfer_pair_id.is_some() {
        return Ok(ReviewWrite::Refused);
    }
    if let Some(c) = category_id {
        let mine = sqlx::query_scalar!(
            r#"select exists(select 1 from budget_category where id = $1 and user_id = $2) as "e!""#,
            c,
            user_id
        )
        .fetch_one(pool)
        .await?;
        if !mine {
            return Ok(ReviewWrite::Refused);
        }
    }
    sqlx::query!(
        r#"
        update transaction
           set budget_category_id = $2,
               category_source = 'ai',
               category_confidence = $3,
               category_reviewed_at = null
         where id = $1
        "#,
        txn_id,
        category_id,
        confidence.map(|c| c.max(Decimal::ZERO).min(Decimal::ONE)),
    )
    .execute(pool)
    .await?;
    Ok(ReviewWrite::Done)
}

/// The queue's size — the amber segment and the banner. Same predicate as the
/// list's `needs_review` (`query.rs`), transfers included, PEA legs excluded;
/// `the_count_agrees_with_the_list_filter` pins that.
pub async fn review_count(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    threshold: Decimal,
) -> Result<i64, CoreError> {
    Ok(sqlx::query_scalar!(
        r#"
        select count(*) as "n!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        left join budget_category bc on bc.id = t.budget_category_id
        where k.user_id = $1
          and not (a.type_key = 'pea' and t.external_id is not null and t.type in ('buy', 'sell'))
          and t.category_source = 'ai'
          and t.category_reviewed_at is null
          and (t.category_confidence is null
               or t.category_confidence < $2
               or bc.kind in ('internal', 'excluded'))
        "#,
        user_id,
        threshold
    )
    .fetch_one(pool)
    .await?)
}
