//! Persistence for the AI run (phase 5 spec §4): the per-user lock, the work
//! set, the evidence, the guarded writes and the run log.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::budget::ai::Decision;
use crate::categorize::{CategoryOption, Example};
use crate::error::CoreError;

/// Same-description evidence per item, then trigram neighbours (spec §4.3).
const SAME_DESCRIPTION: i64 = 20;
const NEIGHBOURS: i64 = 5;

pub async fn try_lock(pool: &sqlx::PgPool, user_id: Uuid) -> Result<bool, CoreError> {
    let n = sqlx::query!(
        "insert into budget_ai_lock (user_id) values ($1) on conflict do nothing",
        user_id
    )
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n == 1)
}

pub async fn unlock(pool: &sqlx::PgPool, user_id: Uuid) -> Result<(), CoreError> {
    sqlx::query!("delete from budget_ai_lock where user_id = $1", user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn is_locked(pool: &sqlx::PgPool, user_id: Uuid) -> Result<bool, CoreError> {
    Ok(sqlx::query_scalar!(
        r#"select exists(select 1 from budget_ai_lock where user_id = $1) as "e!""#,
        user_id
    )
    .fetch_one(pool)
    .await?)
}

/// Boot sweep: every lock predates this process (single-instance app).
pub async fn clear_all_locks(pool: &sqlx::PgPool) -> Result<u64, CoreError> {
    Ok(sqlx::query!("delete from budget_ai_lock")
        .execute(pool)
        .await?
        .rows_affected())
}

pub async fn active_categories(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<CategoryOption>, CoreError> {
    let rows = sqlx::query!(
        r#"
        select id, name, kind, hint
        from budget_category
        where user_id = $1 and archived_at is null
        order by kind, sort_order, name
        "#,
        user_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| CategoryOption {
            id: r.id,
            name: r.name,
            kind: r.kind,
            hint: r.hint,
        })
        .collect())
}

pub struct WorkRow {
    pub id: Uuid,
    pub description: Option<String>,
    pub amount: Decimal,
    pub currency: String,
    pub account_type: String,
    pub day: NaiveDate,
}

/// The next chunk: uncategorised, never-attempted cash rows, newest first.
/// The PEA's provider buy/sell legs are excluded — the list hides them
/// (`query.rs`), so a guess on one could never be reviewed.
pub async fn work_chunk(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<WorkRow>, CoreError> {
    Ok(sqlx::query_as!(
        WorkRow,
        r#"
        select t.id, t.description, t.amount, a.currency, a.type_key as account_type,
               (t.ts at time zone 'utc')::date as "day!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where k.user_id = $1
          and t.category_source is null
          and t.budget_category_id is null
          and t.amount <> 0
          and not (a.type_key = 'pea' and t.external_id is not null and t.type in ('buy', 'sell'))
        order by t.ts desc, t.id
        limit $2
        "#,
        user_id,
        limit,
    )
    .fetch_all(pool)
    .await?)
}

/// How many rows the next runs still have to send — the banner's "N left".
pub async fn remaining(pool: &sqlx::PgPool, user_id: Uuid) -> Result<i64, CoreError> {
    Ok(sqlx::query_scalar!(
        r#"
        select count(*) as "n!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where k.user_id = $1
          and t.category_source is null
          and t.budget_category_id is null
          and t.amount <> 0
          and not (a.type_key = 'pea' and t.external_id is not null and t.type in ('buy', 'sell'))
        "#,
        user_id
    )
    .fetch_one(pool)
    .await?)
}

/// Evidence per item: up to 20 confirmed rows with the same normalised
/// description (most recent first), then up to 5 confirmed rows with the
/// most similar other descriptions. "Confirmed" = the user set it, or
/// reviewed an AI guess. One statement for the whole chunk.
pub async fn examples_for(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<Example>>, CoreError> {
    let rows = sqlx::query!(
        r#"
        with confirmed as (
            select t.id, t.description, t.amount, a.currency, a.type_key,
                   (t.ts at time zone 'utc')::date as day, t.ts,
                   t.budget_category_id as category_id,
                   budget_norm_description(t.description) as norm
            from transaction t
            join account a    on a.id = t.account_id
            join connection k on k.id = a.connection_id
            where k.user_id = $1
              and t.budget_category_id is not null
              and (t.category_source = 'user' or t.category_reviewed_at is not null)
        ),
        items as (
            select t.id, budget_norm_description(t.description) as norm
            from transaction t where t.id = any($2)
        )
        select i.id as "item_id!", e.description, e.amount as "amount!", e.currency as "currency!",
               e.type_key as "account_type!", e.day as "day!", e.category_id as "category_id!"
        from items i
        cross join lateral (
            (select c.description, c.amount, c.currency, c.type_key, c.day, c.category_id
               from confirmed c
              where i.norm <> '' and c.norm = i.norm and c.id <> i.id
              order by c.ts desc
              limit $3)
            union all
            (select c.description, c.amount, c.currency, c.type_key, c.day, c.category_id
               from confirmed c
              where c.norm is distinct from i.norm and c.norm <> ''
                and similarity(c.norm, i.norm) > 0.3
              order by similarity(c.norm, i.norm) desc, c.ts desc
              limit $4)
        ) e
        "#,
        user_id,
        ids,
        SAME_DESCRIPTION,
        NEIGHBOURS,
    )
    .fetch_all(pool)
    .await?;
    let mut map: HashMap<Uuid, Vec<Example>> = HashMap::new();
    for r in rows {
        map.entry(r.item_id).or_default().push(Example {
            description: r.description.unwrap_or_default(),
            amount: r.amount,
            currency: r.currency,
            account_type: r.account_type,
            date: r.day,
            category_id: r.category_id,
        });
    }
    Ok(map)
}

/// The most recent reviews and corrections, shared by every item of a request.
pub async fn recent_corrections(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<Example>, CoreError> {
    let rows = sqlx::query!(
        r#"
        select t.description, t.amount, a.currency, a.type_key,
               (t.ts at time zone 'utc')::date as "day!",
               t.budget_category_id as "category_id!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where k.user_id = $1
          and t.budget_category_id is not null
          and t.category_reviewed_at is not null
        order by t.category_reviewed_at desc
        limit $2
        "#,
        user_id,
        limit,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Example {
            description: r.description.unwrap_or_default(),
            amount: r.amount,
            currency: r.currency,
            account_type: r.type_key,
            date: r.day,
            category_id: r.category_id,
        })
        .collect())
}

/// Writes one chunk in one transaction, after the network call returned.
/// Guarded so an answer never overwrites a row someone categorised in the
/// meantime; a category deleted meanwhile degrades to an abstention rather
/// than failing the chunk on the foreign key. Returns rows written.
pub async fn write_decisions(
    pool: &sqlx::PgPool,
    decisions: &[Decision],
) -> Result<u64, CoreError> {
    let mut tx = pool.begin().await?;
    let mut written = 0;
    for d in decisions {
        written += sqlx::query!(
            r#"
            update transaction
               set budget_category_id   = (select id from budget_category where id = $2),
                   category_source      = 'ai',
                   category_confidence  = case when exists (select 1 from budget_category where id = $2)
                                               then $3::numeric end,
                   category_reviewed_at = null
             where id = $1
               and category_source is null
               and budget_category_id is null
            "#,
            d.txn_id,
            d.category_id,
            d.confidence,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
    }
    tx.commit().await?;
    Ok(written)
}

pub struct RunRecord {
    pub model: String,
    pub batches: i32,
    pub items: i32,
    pub tokens_in: Option<i32>,
    pub tokens_out: Option<i32>,
    pub outcome: String,
    pub error: Option<String>,
}

pub async fn insert_run(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    r: &RunRecord,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        insert into budget_ai_run (user_id, model, batches, items, tokens_in, tokens_out, outcome, error)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
        user_id,
        r.model,
        r.batches,
        r.items,
        r.tokens_in,
        r.tokens_out,
        r.outcome,
        r.error,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub struct LastRun {
    pub outcome: String,
    pub error: Option<String>,
    pub started_at: DateTime<Utc>,
}

pub async fn last_run(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Option<LastRun>, CoreError> {
    Ok(sqlx::query_as!(
        LastRun,
        r#"
        select outcome, error, started_at
        from budget_ai_run
        where user_id = $1
        order by started_at desc
        limit 1
        "#,
        user_id
    )
    .fetch_optional(pool)
    .await?)
}
