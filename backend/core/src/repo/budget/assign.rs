//! What a user does to one transaction, or to many at once.
//!
//! Every write here is `category_source = 'user'` (spec §4): it outranks every
//! pipeline stage, survives a re-run, and joins the AI's example pool. Clearing
//! a category nulls the source too, handing the row back to the pipeline.

use uuid::Uuid;

use crate::error::CoreError;

pub async fn set_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
) -> Result<bool, CoreError> {
    let done = sqlx::query!(
        r#"
        update transaction t
           set budget_category_id = $3,
               category_source = case when $3::uuid is null then null else 'user' end,
               category_confidence = null,
               category_reviewed_at = case when $3::uuid is null then null else now() end
          from account a
          join connection k on k.id = a.connection_id
         where t.id = $1 and a.id = t.account_id and k.user_id = $2
           and ($3::uuid is null
                or exists (select 1 from budget_category c
                            where c.id = $3 and c.user_id = $2))
        "#,
        txn_id,
        user_id,
        category_id,
    )
    .execute(pool)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// Replaces the transaction's tag set wholesale. An empty slice clears it.
/// Returns false when the transaction is not this user's.
pub async fn set_tags(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    tag_ids: &[Uuid],
) -> Result<bool, CoreError> {
    let mut tx = pool.begin().await?;

    let owned = sqlx::query_scalar!(
        r#"
        select count(*) as "n!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where t.id = $1 and k.user_id = $2
        "#,
        txn_id,
        user_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    if owned == 0 {
        return Ok(false);
    }

    sqlx::query!(
        "delete from budget_transaction_tag where transaction_id = $1",
        txn_id
    )
    .execute(&mut *tx)
    .await?;

    // Foreign tag ids are filtered by the join, not rejected: the caller is a
    // UI that can only offer this user's tags, and a partial write is worse
    // than a quietly ignored id.
    sqlx::query!(
        r#"
        insert into budget_transaction_tag (transaction_id, tag_id)
        select $1, g.id from budget_tag g
        where g.user_id = $2 and g.id = any($3)
        "#,
        txn_id,
        user_id,
        tag_ids,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(true)
}

pub async fn set_checked(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    checked: bool,
) -> Result<bool, CoreError> {
    let done = sqlx::query!(
        r#"
        update transaction t
           set checked_at = case when $3 then now() else null end
          from account a
          join connection k on k.id = a.connection_id
         where t.id = $1 and a.id = t.account_id and k.user_id = $2
        "#,
        txn_id,
        user_id,
        checked,
    )
    .execute(pool)
    .await?;
    Ok(done.rows_affected() > 0)
}

pub async fn bulk_set_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_ids: &[Uuid],
    category_id: Option<Uuid>,
) -> Result<u64, CoreError> {
    let done = sqlx::query!(
        r#"
        update transaction t
           set budget_category_id = $3,
               category_source = case when $3::uuid is null then null else 'user' end,
               category_confidence = null,
               category_reviewed_at = case when $3::uuid is null then null else now() end
          from account a
          join connection k on k.id = a.connection_id
         where t.id = any($1) and a.id = t.account_id and k.user_id = $2
           and ($3::uuid is null
                or exists (select 1 from budget_category c
                            where c.id = $3 and c.user_id = $2))
        "#,
        txn_ids,
        user_id,
        category_id,
    )
    .execute(pool)
    .await?;
    Ok(done.rows_affected())
}

/// Adds tags without removing what is already there; re-adding is a no-op.
/// Returns the number of transactions touched, not the number of rows inserted.
/// An empty `tag_ids` touches nothing and returns 0 — there is no tag to add,
/// so no transaction is touched by any definition.
pub async fn bulk_add_tags(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_ids: &[Uuid],
    tag_ids: &[Uuid],
) -> Result<u64, CoreError> {
    if tag_ids.is_empty() {
        return Ok(0);
    }
    let touched = sqlx::query_scalar!(
        r#"
        with owned as (
            select t.id
            from transaction t
            join account a    on a.id = t.account_id
            join connection k on k.id = a.connection_id
            where t.id = any($1) and k.user_id = $2
        ), mine as (
            select id from budget_tag where user_id = $2 and id = any($3)
        ), ins as (
            insert into budget_transaction_tag (transaction_id, tag_id)
            select owned.id, mine.id from owned cross join mine
            on conflict do nothing
            returning transaction_id
        )
        select count(*) as "n!" from owned
        "#,
        txn_ids,
        user_id,
        tag_ids,
    )
    .fetch_one(pool)
    .await?;
    Ok(touched as u64)
}

pub async fn bulk_set_checked(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_ids: &[Uuid],
    checked: bool,
) -> Result<u64, CoreError> {
    let done = sqlx::query!(
        r#"
        update transaction t
           set checked_at = case when $3 then now() else null end
          from account a
          join connection k on k.id = a.connection_id
         where t.id = any($1) and a.id = t.account_id and k.user_id = $2
        "#,
        txn_ids,
        user_id,
        checked,
    )
    .execute(pool)
    .await?;
    Ok(done.rows_affected())
}

/// How many *other* transactions of this user share the row's normalised
/// description — the number the "apply to all?" prompt shows.
///
/// Guards on the *normalised* value, not the raw one: `budget_norm_description`
/// collapses any run of 2+ digits, so a raw description like `"12345"` is
/// non-blank yet normalises to `''`, same as NULL or empty. A row whose
/// normalised description is `''` carries no merchant identity, so it must
/// never cluster with anything — including another digit-only description.
pub async fn count_same_description(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
) -> Result<i64, CoreError> {
    let n = sqlx::query_scalar!(
        r#"
        select count(*) as "n!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where k.user_id = $2
          and t.id <> $1
          and budget_norm_description(t.description) <> ''
          and budget_norm_description(t.description) = (
              select budget_norm_description(t2.description)
              from transaction t2
              join account a2    on a2.id = t2.account_id
              join connection k2 on k2.id = a2.connection_id
              where t2.id = $1 and k2.user_id = $2
                and budget_norm_description(t2.description) <> ''
          )
        "#,
        txn_id,
        user_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(n)
}

/// Applies the category to the row and to every transaction sharing its
/// normalised description. Returns how many rows were written, the row itself
/// included.
///
/// Mirrors `count_same_description`'s row set exactly, including its
/// blank-description exclusion: a description that is null, empty, or
/// normalises to `''` (e.g. digit-only) never clusters with other blank
/// descriptions as "the same merchant". If the anchor row's own description
/// is blank, the inner subquery excludes it too, so the equality compares
/// against `NULL` and nothing matches — the apply is a no-op.
pub async fn apply_category_to_same_description(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
) -> Result<u64, CoreError> {
    let done = sqlx::query!(
        r#"
        update transaction t
           set budget_category_id = $3,
               category_source = case when $3::uuid is null then null else 'user' end,
               category_confidence = null,
               category_reviewed_at = case when $3::uuid is null then null else now() end
          from account a
          join connection k on k.id = a.connection_id
         where a.id = t.account_id and k.user_id = $2
           and budget_norm_description(t.description) <> ''
           and budget_norm_description(t.description) = (
               select budget_norm_description(t2.description)
               from transaction t2
               join account a2    on a2.id = t2.account_id
               join connection k2 on k2.id = a2.connection_id
               where t2.id = $1 and k2.user_id = $2
                 and budget_norm_description(t2.description) <> ''
           )
           and ($3::uuid is null
                or exists (select 1 from budget_category c
                            where c.id = $3 and c.user_id = $2))
        "#,
        txn_id,
        user_id,
        category_id,
    )
    .execute(pool)
    .await?;
    Ok(done.rows_affected())
}
