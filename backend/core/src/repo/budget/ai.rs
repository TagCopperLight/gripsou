//! Persistence for the AI run: the per-user lock, the work
//! set, the evidence, the guarded writes and the run log.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::budget::ai::Decision;
use crate::categorize::{CategoryOption, Example, Usage};
use crate::error::CoreError;

/// Same-description evidence per item, then trigram neighbours.
const SAME_DESCRIPTION: i64 = 20;
const NEIGHBOURS: i64 = 5;

/// A lock whose run has not beaten for this long belongs to a dead task (a
/// run beats once per batch, and a batch is bounded by the adapters' HTTP
/// timeouts) and may be taken over.
pub const LOCK_STALE_MINS: i32 = 30;

/// Claims the user, or takes over a lock whose heartbeat is stale.
pub async fn try_lock(pool: &sqlx::PgPool, user_id: Uuid) -> Result<bool, CoreError> {
    let n = sqlx::query!(
        r#"
        insert into budget_ai_lock (user_id) values ($1)
        on conflict (user_id) do update set heartbeat_at = now()
         where budget_ai_lock.heartbeat_at < now() - make_interval(mins => $2)
        "#,
        user_id,
        LOCK_STALE_MINS,
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

/// Closes runs still marked `running` as `error`: for one user once their
/// lock is held, or for everyone at boot. Either way no live task owns them.
pub async fn close_abandoned_runs(
    pool: &sqlx::PgPool,
    user_id: Option<Uuid>,
) -> Result<u64, CoreError> {
    Ok(sqlx::query!(
        r#"
        update budget_ai_run
           set outcome = 'error', error = 'the run stopped before finishing'
         where outcome = 'running'
           and ($1::uuid is null or user_id = $1)
        "#,
        user_id as Option<Uuid>,
    )
    .execute(pool)
    .await?
    .rows_affected())
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

/// The next chunk: uncategorised cash rows, newest first, minus the ones this
/// run already sent (`skip`). The PEA's provider buy/sell legs are excluded —
/// the list hides them (`query.rs`), so a guess on one could never be reviewed.
pub async fn work_chunk(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    skip: &[Uuid],
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
          and not budget_hidden_pea_leg(a.type_key, t.external_id, t.type)
          and t.id <> all($2)
        order by t.ts desc, t.id
        limit $3
        "#,
        user_id,
        skip,
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
          and not budget_hidden_pea_leg(a.type_key, t.external_id, t.type)
        "#,
        user_id
    )
    .fetch_one(pool)
    .await?)
}

/// Evidence per item: up to 20 confirmed rows with the same normalised
/// description (most recent first), then up to 5 confirmed rows with the
/// most similar other descriptions. "Confirmed" = the user set it, or
/// reviewed an AI guess. One statement for the whole chunk; both lookups go
/// through the indexes on `description_norm`. Items not owned by `user_id`
/// get no evidence.
pub async fn examples_for(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<Example>>, CoreError> {
    let rows = sqlx::query!(
        r#"
        with items as (
            select t.id, t.description_norm as norm
            from transaction t
            join account a    on a.id = t.account_id
            join connection k on k.id = a.connection_id
            where k.user_id = $1 and t.id = any($2) and t.description_norm <> ''
        )
        select i.id as "item_id!", e.description, e.amount as "amount!", e.currency as "currency!",
               e.type_key as "account_type!", e.day as "day!", e.category_id as "category_id!"
        from items i
        cross join lateral (
            (select c.description, c.amount, a.currency, a.type_key,
                    (c.ts at time zone 'utc')::date as day, c.budget_category_id as category_id
               from transaction c
               join account a    on a.id = c.account_id
               join connection k on k.id = a.connection_id
              where c.description_norm = i.norm
                and c.id <> i.id
                and k.user_id = $1
                and c.budget_category_id is not null
                and (c.category_source = 'user' or c.category_reviewed_at is not null)
              order by c.ts desc, c.id
              limit $3)
            union all
            (select c.description, c.amount, a.currency, a.type_key,
                    (c.ts at time zone 'utc')::date as day, c.budget_category_id as category_id
               from transaction c
               join account a    on a.id = c.account_id
               join connection k on k.id = a.connection_id
              where c.description_norm % i.norm
                and similarity(c.description_norm, i.norm) > 0.3
                and c.description_norm <> i.norm
                and k.user_id = $1
                and c.budget_category_id is not null
                and (c.category_source = 'user' or c.category_reviewed_at is not null)
              order by similarity(c.description_norm, i.norm) desc, c.ts desc, c.id
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

/// Writes one chunk's answers in one statement, after the network call
/// returned. Guarded so an answer never overwrites a row someone categorised
/// in the meantime, and never touches a row or a category of another user; a
/// category deleted meanwhile degrades to an abstention rather than failing
/// the chunk on the foreign key. Returns rows written.
pub async fn write_decisions(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    decisions: &[Decision],
) -> Result<u64, CoreError> {
    let txn_ids: Vec<Uuid> = decisions.iter().map(|d| d.txn_id).collect();
    let categories: Vec<Option<Uuid>> = decisions.iter().map(|d| d.category_id).collect();
    let confidences: Vec<Option<Decimal>> = decisions.iter().map(|d| d.confidence).collect();
    Ok(sqlx::query!(
        r#"
        update transaction t
           set budget_category_id   = c.id,
               category_source      = 'ai',
               category_confidence  = case when c.id is not null then d.confidence end,
               category_reviewed_at = null
          from unnest($2::uuid[], $3::uuid[], $4::numeric[]) as d (txn_id, category_id, confidence)
          left join budget_category c on c.id = d.category_id and c.user_id = $1
         where t.id = d.txn_id
           and t.category_source is null
           and t.budget_category_id is null
           and exists (select 1
                         from account a
                         join connection k on k.id = a.connection_id
                        where a.id = t.account_id and k.user_id = $1)
        "#,
        user_id,
        &txn_ids,
        &categories as &[Option<Uuid>],
        &confidences as &[Option<Decimal>],
    )
    .execute(pool)
    .await?
    .rows_affected())
}

/// Opens the run's log row, marked `running`, at the real start of the run.
pub async fn start_run(pool: &sqlx::PgPool, user_id: Uuid, model: &str) -> Result<Uuid, CoreError> {
    Ok(sqlx::query_scalar!(
        "insert into budget_ai_run (user_id, model) values ($1, $2) returning id",
        user_id,
        model,
    )
    .fetch_one(pool)
    .await?)
}

/// Adds one call's tokens to the run, and beats the user's lock so a live
/// run is never taken for a dead one.
pub async fn record_usage(
    pool: &sqlx::PgPool,
    run_id: Uuid,
    user_id: Uuid,
    usage: Usage,
) -> Result<(), CoreError> {
    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"
        update budget_ai_run
           set tokens_in      = tokens_in + $2,
               tokens_out     = tokens_out + $3,
               usage_complete = usage_complete and $4
         where id = $1
        "#,
        run_id,
        usage.tokens_in,
        usage.tokens_out,
        usage.complete,
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        "update budget_ai_lock set heartbeat_at = now() where user_id = $1",
        user_id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Closes the run: `ok` | `partial` | `error`.
pub async fn finish_run(
    pool: &sqlx::PgPool,
    run_id: Uuid,
    outcome: &str,
    error: Option<&str>,
) -> Result<(), CoreError> {
    sqlx::query!(
        "update budget_ai_run set outcome = $2, error = $3 where id = $1",
        run_id,
        outcome,
        error,
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

/// The latest finished run. A live one is reported by the lock instead.
pub async fn last_run(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Option<LastRun>, CoreError> {
    Ok(sqlx::query_as!(
        LastRun,
        r#"
        select outcome, error, started_at
        from budget_ai_run
        where user_id = $1 and outcome <> 'running'
        order by started_at desc
        limit 1
        "#,
        user_id
    )
    .fetch_optional(pool)
    .await?)
}

/// Token totals for one model across every user's runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelUsage {
    pub model: String,
    pub runs: i64,
    /// Runs with at least one call whose provider did not report its token
    /// counts: their tokens are included but under-count the bill.
    pub runs_without_usage: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
}

/// Per-model totals over all users, ordered by model key. A run still going
/// counts with the tokens spent so far.
pub async fn usage_by_model(pool: &sqlx::PgPool) -> Result<Vec<ModelUsage>, CoreError> {
    Ok(sqlx::query_as!(
        ModelUsage,
        r#"
        select model,
               count(*) as "runs!",
               count(*) filter (where not usage_complete) as "runs_without_usage!",
               coalesce(sum(tokens_in), 0)::bigint as "tokens_in!",
               coalesce(sum(tokens_out), 0)::bigint as "tokens_out!"
        from budget_ai_run
        group by model
        order by model
        "#
    )
    .fetch_all(pool)
    .await?)
}
