//! What a user does to one transaction, or to many at once.
//!
//! Every write here is `category_source = 'user'` (spec §4): it outranks every
//! pipeline stage, survives a re-run, and joins the AI's example pool. Clearing
//! a category nulls the source too, handing the row back to the pipeline.
//!
//! **A user category write dissolves any internal-transfer pair it touches.**
//! Spec §4 lets the user overrule pairing — it is a timid heuristic, but it can
//! still false-match two unrelated movements of the same amount. What must not
//! survive the correction is the link: a row still pointing at a counterpart
//! that is no longer a transfer is a half-transfer that nets against nothing,
//! and the pairing pass will never revisit it (`budget::pairing` only considers
//! rows where `transfer_pair_id is null`). So every category writer here runs
//! in a transaction and calls [`dissolve_pairs`] with the ids it actually
//! wrote. Both halves lose `transfer_pair_id`; the untouched half keeps its
//! category and its `category_source = 'pair'`, which is what surfaces it to
//! the reader as an orphaned transfer.

use uuid::Uuid;

use crate::error::CoreError;

/// Unlinks every internal-transfer pair that `ids` takes part in — both the
/// listed row and its counterpart. Ids the caller did not just write, or that
/// carry no pair, are no-ops.
///
/// Ownership is the caller's business: it passes only ids its own
/// user-scoped UPDATE returned. The counterpart needs no separate check, since
/// pairing only ever matches two accounts of the same user.
async fn dissolve_pairs(conn: &mut sqlx::PgConnection, ids: &[Uuid]) -> Result<(), CoreError> {
    if ids.is_empty() {
        return Ok(());
    }
    sqlx::query!(
        r#"
        with victims as (
            select id, transfer_pair_id
            from transaction
            where id = any($1) and transfer_pair_id is not null
        )
        update transaction t
           set transfer_pair_id = null
         where t.id in (select id from victims)
            or t.id in (select transfer_pair_id from victims)
        "#,
        ids,
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// How many of `ids` are half of an internal transfer — i.e. how many of the
/// caller's own rows a category write over this set would unlink.
///
/// Counts rows, not pairs: when a selection holds both halves it returns 2,
/// because what the confirmation names is how many transactions change, which
/// is the number the user can check against what they selected.
pub async fn count_paired(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    ids: &[Uuid],
) -> Result<i64, CoreError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let n = sqlx::query_scalar!(
        r#"
        select count(*) as "n!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where t.id = any($1) and k.user_id = $2 and t.transfer_pair_id is not null
        "#,
        ids,
        user_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(n)
}

pub async fn set_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
) -> Result<bool, CoreError> {
    let mut tx = pool.begin().await?;
    let written: Option<Uuid> = sqlx::query_scalar!(
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
        returning t.id
        "#,
        txn_id,
        user_id,
        category_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some(id) = written else {
        return Ok(false);
    };
    dissolve_pairs(&mut tx, &[id]).await?;
    tx.commit().await?;
    Ok(true)
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
    let mut tx = pool.begin().await?;
    let written: Vec<Uuid> = sqlx::query_scalar!(
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
        returning t.id
        "#,
        txn_ids,
        user_id,
        category_id,
    )
    .fetch_all(&mut *tx)
    .await?;
    let updated = written.len() as u64;
    dissolve_pairs(&mut tx, &written).await?;
    tx.commit().await?;
    Ok(updated)
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

/// How many internal-transfer pairs an [`apply_category_to_same_description`]
/// over this row would dissolve.
///
/// Mirrors that function's row set — the anchor row **included** — rather than
/// `count_same_description`'s, which excludes it. The count must describe the
/// write that will actually happen, not the "and N others" figure the offer is
/// phrased with.
pub async fn count_paired_same_description(
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
          and t.transfer_pair_id is not null
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
/// normalised description. Returns the ids written, the row itself included —
/// the review queue needs to know *which* of its lines this resolved.
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
) -> Result<Vec<Uuid>, CoreError> {
    let mut tx = pool.begin().await?;
    let written: Vec<Uuid> = sqlx::query_scalar!(
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
        returning t.id
        "#,
        txn_id,
        user_id,
        category_id,
    )
    .fetch_all(&mut *tx)
    .await?;
    dissolve_pairs(&mut tx, &written).await?;
    tx.commit().await?;
    Ok(written)
}

/// What a bulk write changes. Every field is optional: a call may set a
/// category, add tags, flip the checked flag, or any combination. `category_id`
/// is doubly-optional — `None` means "leave the category alone", `Some(None)`
/// means "clear it".
#[derive(Default)]
pub struct BulkChanges<'a> {
    pub category_id: Option<Option<Uuid>>,
    pub add_tag_ids: Option<&'a [Uuid]>,
    pub checked: Option<bool>,
}

/// The result of a bulk write. `pending_pair_breaks` is `Some(n)` only when the
/// call was refused pending confirmation — and then nothing was written.
pub struct BulkOutcome {
    pub updated: u64,
    pub pending_pair_breaks: Option<i64>,
}

/// Applies one bulk write, guarding the pairs it would dissolve.
///
/// A category write unlinks every internal-transfer pair it touches (see this
/// module's header). "Select all shown" resolves server-side and can hold rows
/// the client has never loaded, so the client cannot count those pairs itself
/// — this does, and refuses until the caller confirms.
///
/// The guard runs **before any write**, tags and checked included: a refused
/// call that had already flipped the checked flag would leave the user looking
/// at a half-applied change they never agreed to. Tags and the checked flag
/// break no pairs, so a call carrying neither a category nor a confirmation is
/// never gated.
pub async fn bulk_apply(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    ids: &[Uuid],
    changes: BulkChanges<'_>,
    confirm_break_pairs: bool,
) -> Result<BulkOutcome, CoreError> {
    if changes.category_id.is_some() && !confirm_break_pairs {
        let breaks = count_paired(pool, user_id, ids).await?;
        if breaks > 0 {
            return Ok(BulkOutcome {
                updated: 0,
                pending_pair_breaks: Some(breaks),
            });
        }
    }

    // `max`, not a sum: each arm touches the same rows, so adding them would
    // report a multiple of the selection the user is looking at.
    let mut updated = 0u64;
    if let Some(category_id) = changes.category_id {
        updated = updated.max(bulk_set_category(pool, user_id, ids, category_id).await?);
    }
    if let Some(tag_ids) = changes.add_tag_ids
        && !tag_ids.is_empty()
    {
        updated = updated.max(bulk_add_tags(pool, user_id, ids, tag_ids).await?);
    }
    if let Some(checked) = changes.checked {
        updated = updated.max(bulk_set_checked(pool, user_id, ids, checked).await?);
    }
    Ok(BulkOutcome {
        updated,
        pending_pair_breaks: None,
    })
}
