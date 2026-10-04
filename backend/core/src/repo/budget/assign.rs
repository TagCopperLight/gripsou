//! What a user does to one transaction, or to many at once.
//!
//! Every write here is `category_source = 'user'`: it outranks every
//! pipeline stage, survives a re-run, and joins the AI's example pool. Clearing
//! a category nulls the source too, handing the row back to the pipeline.
//!
//! **A user category write that makes a row count dissolves any
//! internal-transfer pair it touches.** The user may overrule pairing — it is
//! a timid heuristic, but it can still false-match two unrelated movements of
//! the same amount. What must not survive the correction is the link: a row
//! still pointing at a counterpart that is no longer a transfer is a
//! half-transfer that nets against nothing. So every category writer here runs
//! in a transaction and calls [`dissolve_pairs`] with the ids it actually
//! wrote — unless the new category is neutral ([`keeps_pairs`]): Savings or
//! Investments instead of Internal transfer is a finer label for the same
//! movement, which still counts toward nothing either way. Both halves lose
//! `transfer_pair_id`; the untouched half keeps its category and its
//! `category_source = 'pair'`, which surfaces it to the reader as an orphaned
//! transfer, counts as uncategorised in the Overview, and leaves it eligible
//! for the next pairing pass.
//!
//! What the API calls ([`patch_transaction`], [`bulk_apply`],
//! [`apply_to_description`]) each run as one database transaction: they lock
//! the rows they target, check that every category and tag named is the
//! user's, ask for confirmation before dissolving a pair, and only then write.
//! A refused request writes nothing. The lower-level writers below them are
//! the confirmed, unchecked building blocks.

use rust_decimal::Decimal;
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

/// Whether writing `category_id` leaves the pairs it touches alone: a
/// neutral category counts toward nothing, as a pair does, so filing one half
/// under it changes no total and the pair stands. Clearing the category does
/// not keep them — an uncategorised half is not a transfer.
async fn keeps_pairs(
    conn: &mut sqlx::PgConnection,
    category_id: Option<Uuid>,
) -> Result<bool, CoreError> {
    let Some(category_id) = category_id else {
        return Ok(false);
    };
    let neutral = sqlx::query_scalar!(
        r#"select kind = 'neutral' as "neutral!" from budget_category where id = $1"#,
        category_id,
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(neutral.unwrap_or(false))
}

/// Why a write was not made, or what it is waiting for.
#[derive(Debug, PartialEq, Eq)]
pub enum WriteOutcome<T> {
    Done(T),
    /// Nothing was written: the write would unlink this many of the user's
    /// rows from their internal-transfer pairs, and the caller has not
    /// confirmed. Counts rows, not pairs.
    PendingPairBreaks(i64),
    /// The transaction is not this user's.
    NotFound,
    /// The category is not this user's, or no longer exists.
    UnknownCategory,
    /// At least one tag is not this user's, or no longer exists.
    UnknownTag,
}

/// Locks the rows of `ids` this user owns, for the rest of the caller's
/// database transaction, and says which are half of a pair. A sync that
/// pairs one of them has to wait until the write commits, so the pair check
/// the caller makes on this answer still holds when it writes.
async fn lock_owned(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    ids: &[Uuid],
) -> Result<Vec<(Uuid, bool)>, CoreError> {
    let rows = sqlx::query!(
        r#"
        select t.id as "id!", (t.transfer_pair_id is not null) as "paired!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where t.id = any($1) and k.user_id = $2
        order by t.id
        for update of t
        "#,
        ids,
        user_id,
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows.into_iter().map(|r| (r.id, r.paired)).collect())
}

/// Whether a category write to `category_id` is allowed: clearing always is,
/// setting one only if it is the user's. Locks the category row, so a
/// concurrent delete cannot slip in before the write.
async fn category_is_mine(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    category_id: Option<Uuid>,
) -> Result<bool, CoreError> {
    let Some(category_id) = category_id else {
        return Ok(true);
    };
    let found = sqlx::query_scalar!(
        "select id from budget_category where id = $1 and user_id = $2 for share",
        category_id,
        user_id,
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(found.is_some())
}

/// Whether every one of `tag_ids` is the user's. Locks them, as above.
async fn tags_are_mine(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    tag_ids: &[Uuid],
) -> Result<bool, CoreError> {
    let mut wanted = tag_ids.to_vec();
    wanted.sort();
    wanted.dedup();
    if wanted.is_empty() {
        return Ok(true);
    }
    let found = sqlx::query_scalar!(
        "select id from budget_tag where id = any($1) and user_id = $2 for share",
        &wanted,
        user_id,
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok(found.len() == wanted.len())
}

/// The category write itself, over the rows of `ids` this user owns. Returns
/// the ids written and unlinks their pairs, unless the category keeps them
/// ([`keeps_pairs`]). A category that is not the user's writes nothing.
async fn write_category(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    ids: &[Uuid],
    category_id: Option<Uuid>,
) -> Result<Vec<Uuid>, CoreError> {
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
        ids,
        user_id,
        category_id,
    )
    .fetch_all(&mut *conn)
    .await?;
    if !keeps_pairs(conn, category_id).await? {
        dissolve_pairs(conn, &written).await?;
    }
    Ok(written)
}

/// Replaces one owned transaction's tag set. Tags that are not the user's are
/// left out by the join.
async fn replace_tags(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    txn_id: Uuid,
    tag_ids: &[Uuid],
) -> Result<(), CoreError> {
    sqlx::query!(
        "delete from budget_transaction_tag where transaction_id = $1",
        txn_id
    )
    .execute(&mut *conn)
    .await?;
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
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Adds tags to the rows of `ids` this user owns, keeping what is there.
/// Returns how many transactions that covers; none when `tag_ids` is empty.
async fn add_tags(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    ids: &[Uuid],
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
        ids,
        user_id,
        tag_ids,
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(touched as u64)
}

async fn write_checked(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    ids: &[Uuid],
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
        ids,
        user_id,
        checked,
    )
    .execute(&mut *conn)
    .await?;
    Ok(done.rows_affected())
}

/// How many of `ids` are half of an internal transfer — i.e. how many of the
/// caller's own rows a category write over this set would unlink, when the
/// category is not one that keeps pairs ([`keeps_pairs`]).
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

/// Sets one row's category, pair or not. `false` when the row or the category
/// is not the user's.
pub async fn set_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
) -> Result<bool, CoreError> {
    let mut tx = pool.begin().await?;
    let written = write_category(&mut tx, user_id, &[txn_id], category_id).await?;
    tx.commit().await?;
    Ok(!written.is_empty())
}

/// Replaces the transaction's tag set wholesale. An empty slice clears it.
/// Returns false when the transaction is not this user's. Foreign tag ids
/// are left out rather than refused; [`patch_transaction`] refuses them.
pub async fn set_tags(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    tag_ids: &[Uuid],
) -> Result<bool, CoreError> {
    let mut tx = pool.begin().await?;
    if lock_owned(&mut tx, user_id, &[txn_id]).await?.is_empty() {
        return Ok(false);
    }
    replace_tags(&mut tx, user_id, txn_id, tag_ids).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn set_checked(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    checked: bool,
) -> Result<bool, CoreError> {
    let mut conn = pool.acquire().await?;
    Ok(write_checked(&mut conn, user_id, &[txn_id], checked).await? > 0)
}

pub async fn bulk_set_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_ids: &[Uuid],
    category_id: Option<Uuid>,
) -> Result<u64, CoreError> {
    let mut tx = pool.begin().await?;
    let written = write_category(&mut tx, user_id, txn_ids, category_id).await?;
    tx.commit().await?;
    Ok(written.len() as u64)
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
    let mut conn = pool.acquire().await?;
    add_tags(&mut conn, user_id, txn_ids, tag_ids).await
}

pub async fn bulk_set_checked(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_ids: &[Uuid],
    checked: bool,
) -> Result<u64, CoreError> {
    let mut conn = pool.acquire().await?;
    write_checked(&mut conn, user_id, txn_ids, checked).await
}

/// What a single-row save changes. `None` leaves a field alone;
/// `category_id: Some(None)` clears the category.
#[derive(Default)]
pub struct TransactionPatch<'a> {
    pub category_id: Option<Option<Uuid>>,
    pub tag_ids: Option<&'a [Uuid]>,
    pub checked: Option<bool>,
}

/// Saves one row: category, tags and ✓ together or not at all.
///
/// A category write on half of an internal transfer unlinks the pair, so it
/// waits for `confirm_break_pairs` like the bulk paths do
/// ([`WriteOutcome::PendingPairBreaks`]) — unless the category is neutral and
/// keeps the pair. Tags and ✓ break nothing and are never gated.
pub async fn patch_transaction(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    patch: &TransactionPatch<'_>,
    confirm_break_pairs: bool,
) -> Result<WriteOutcome<()>, CoreError> {
    let mut tx = pool.begin().await?;
    let Some(&(_, paired)) = lock_owned(&mut tx, user_id, &[txn_id]).await?.first() else {
        return Ok(WriteOutcome::NotFound);
    };
    if let Some(category_id) = patch.category_id
        && !category_is_mine(&mut tx, user_id, category_id).await?
    {
        return Ok(WriteOutcome::UnknownCategory);
    }
    if let Some(tag_ids) = patch.tag_ids
        && !tags_are_mine(&mut tx, user_id, tag_ids).await?
    {
        return Ok(WriteOutcome::UnknownTag);
    }
    if let Some(category_id) = patch.category_id
        && paired
        && !confirm_break_pairs
        && !keeps_pairs(&mut tx, category_id).await?
    {
        return Ok(WriteOutcome::PendingPairBreaks(1));
    }

    if let Some(category_id) = patch.category_id {
        write_category(&mut tx, user_id, &[txn_id], category_id).await?;
    }
    if let Some(tag_ids) = patch.tag_ids {
        replace_tags(&mut tx, user_id, txn_id, tag_ids).await?;
    }
    if let Some(checked) = patch.checked {
        write_checked(&mut tx, user_id, &[txn_id], checked).await?;
    }
    tx.commit().await?;
    Ok(WriteOutcome::Done(()))
}

/// Which of the rows sharing a description an "apply to the same
/// description" reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SameDescription {
    /// Every one of them, whatever their category or who set it.
    All,
    /// Only the rows still in the review queue at this threshold (the
    /// queue's own `needs_review`), never the anchor: from the queue, a
    /// correction must not overwrite what the user has already settled.
    NeedsReview(Decimal),
}

impl SameDescription {
    fn threshold(self) -> Option<Decimal> {
        match self {
            SameDescription::All => None,
            SameDescription::NeedsReview(t) => Some(t),
        }
    }
}

/// How many *other* transactions of this user share the row's normalised
/// description, within `scope` — the number the "apply to all?" prompt shows.
///
/// Guards on the *normalised* value, not the raw one: `description_norm` (`budget_norm_description`)
/// collapses any run of 2+ digits, so a raw description like `"12345"` is
/// non-blank yet normalises to `''`, same as NULL or empty. A row whose
/// normalised description is `''` carries no merchant identity, so it must
/// never cluster with anything — including another digit-only description.
pub async fn count_same_description(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    scope: SameDescription,
) -> Result<i64, CoreError> {
    let n = sqlx::query_scalar!(
        r#"
        select count(*) as "n!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where k.user_id = $2
          and t.id <> $1
          and t.description_norm <> ''
          and t.description_norm = (
              select t2.description_norm
              from transaction t2
              join account a2    on a2.id = t2.account_id
              join connection k2 on k2.id = a2.connection_id
              where t2.id = $1 and k2.user_id = $2
                and t2.description_norm <> ''
          )
          and ($3::numeric is null
               or (t.id <> $1
                   and t.id in (select r.id from budget_transaction_rows($2, $3) r
                                where r.needs_review)))
        "#,
        txn_id,
        user_id,
        scope.threshold(),
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
    let mut conn = pool.acquire().await?;
    let rows =
        same_description_rows(&mut conn, user_id, txn_id, false, SameDescription::All).await?;
    Ok(rows.iter().filter(|(_, paired)| *paired).count() as i64)
}

/// The anchor row and every transaction of this user sharing its normalised
/// description — or, under [`SameDescription::NeedsReview`], only those still
/// in review, anchor excluded — with whether each is half of a pair. Locks them when `lock`
/// is set.
///
/// A description that is null, empty, or normalises to `''` (e.g.
/// digit-only) never clusters with other blank descriptions as "the same
/// merchant": the inner subquery then yields `NULL`, and nothing matches.
async fn same_description_rows(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
    txn_id: Uuid,
    lock: bool,
    scope: SameDescription,
) -> Result<Vec<(Uuid, bool)>, CoreError> {
    let ids = sqlx::query_scalar!(
        r#"
        select t.id as "id!"
        from transaction t
        join account a    on a.id = t.account_id
        join connection k on k.id = a.connection_id
        where k.user_id = $2
          and t.description_norm <> ''
          and t.description_norm = (
              select t2.description_norm
              from transaction t2
              join account a2    on a2.id = t2.account_id
              join connection k2 on k2.id = a2.connection_id
              where t2.id = $1 and k2.user_id = $2
                and t2.description_norm <> ''
          )
          and ($3::numeric is null
               or (t.id <> $1
                   and t.id in (select r.id from budget_transaction_rows($2, $3) r
                                where r.needs_review)))
        "#,
        txn_id,
        user_id,
        scope.threshold(),
    )
    .fetch_all(&mut *conn)
    .await?;
    if lock {
        lock_owned(conn, user_id, &ids).await
    } else {
        let paired = sqlx::query!(
            r#"select id as "id!", (transfer_pair_id is not null) as "paired!"
               from transaction where id = any($1)"#,
            &ids,
        )
        .fetch_all(&mut *conn)
        .await?;
        Ok(paired.into_iter().map(|r| (r.id, r.paired)).collect())
    }
}

/// Applies the category to the row and to every transaction sharing its
/// normalised description, pairs included — unlinked unless the category
/// keeps them. Returns the ids written, the row itself included. A category
/// that is not the user's writes nothing. [`apply_to_description`] is the
/// checked form the API calls.
pub async fn apply_category_to_same_description(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
) -> Result<Vec<Uuid>, CoreError> {
    let mut tx = pool.begin().await?;
    let rows = same_description_rows(&mut tx, user_id, txn_id, true, SameDescription::All).await?;
    let ids: Vec<Uuid> = rows.iter().map(|(id, _)| *id).collect();
    let written = write_category(&mut tx, user_id, &ids, category_id).await?;
    tx.commit().await?;
    Ok(written)
}

/// "Apply to the same description", as one database transaction: the rows
/// in `scope` are locked, the category checked, and a write that would unlink
/// pairs waits for `confirm_break_pairs`. Returns the ids written (the row
/// itself included under [`SameDescription::All`]) — the review queue needs
/// to know *which* of its lines this resolved.
pub async fn apply_to_description(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
    scope: SameDescription,
    confirm_break_pairs: bool,
) -> Result<WriteOutcome<Vec<Uuid>>, CoreError> {
    let mut tx = pool.begin().await?;
    if lock_owned(&mut tx, user_id, &[txn_id]).await?.is_empty() {
        return Ok(WriteOutcome::NotFound);
    }
    if !category_is_mine(&mut tx, user_id, category_id).await? {
        return Ok(WriteOutcome::UnknownCategory);
    }
    let rows = same_description_rows(&mut tx, user_id, txn_id, true, scope).await?;
    let breaks = rows.iter().filter(|(_, paired)| *paired).count() as i64;
    if breaks > 0 && !confirm_break_pairs && !keeps_pairs(&mut tx, category_id).await? {
        return Ok(WriteOutcome::PendingPairBreaks(breaks));
    }
    let ids: Vec<Uuid> = rows.iter().map(|(id, _)| *id).collect();
    let written = write_category(&mut tx, user_id, &ids, category_id).await?;
    tx.commit().await?;
    Ok(WriteOutcome::Done(written))
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

/// Applies one bulk write as one database transaction. Returns how many of
/// the user's rows it covered.
///
/// A category write unlinks every internal-transfer pair it touches, unless
/// the category is neutral (see this module's header). "Select all shown" resolves server-side and can hold rows
/// the client has never loaded, so the client cannot count those pairs itself
/// — this does, on the locked rows, and refuses until the caller confirms.
/// A refused call writes nothing, tags and ✓ included. Tags and ✓ break no
/// pairs, so a call carrying no category is never gated.
pub async fn bulk_apply(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    ids: &[Uuid],
    changes: BulkChanges<'_>,
    confirm_break_pairs: bool,
) -> Result<WriteOutcome<u64>, CoreError> {
    let add_tag_ids = changes.add_tag_ids.filter(|t| !t.is_empty());
    let mut tx = pool.begin().await?;
    let rows = lock_owned(&mut tx, user_id, ids).await?;
    if let Some(category_id) = changes.category_id
        && !category_is_mine(&mut tx, user_id, category_id).await?
    {
        return Ok(WriteOutcome::UnknownCategory);
    }
    if let Some(tag_ids) = add_tag_ids
        && !tags_are_mine(&mut tx, user_id, tag_ids).await?
    {
        return Ok(WriteOutcome::UnknownTag);
    }
    let breaks = rows.iter().filter(|(_, paired)| *paired).count() as i64;
    if let Some(category_id) = changes.category_id
        && breaks > 0
        && !confirm_break_pairs
        && !keeps_pairs(&mut tx, category_id).await?
    {
        return Ok(WriteOutcome::PendingPairBreaks(breaks));
    }

    let owned: Vec<Uuid> = rows.iter().map(|(id, _)| *id).collect();
    if let Some(category_id) = changes.category_id {
        write_category(&mut tx, user_id, &owned, category_id).await?;
    }
    if let Some(tag_ids) = add_tag_ids {
        add_tags(&mut tx, user_id, &owned, tag_ids).await?;
    }
    if let Some(checked) = changes.checked {
        write_checked(&mut tx, user_id, &owned, checked).await?;
    }
    tx.commit().await?;
    // Every arm covers the same locked rows, so that is the count — not a sum
    // of arms, which would report a multiple of the selection.
    let wrote_anything =
        changes.category_id.is_some() || add_tag_ids.is_some() || changes.checked.is_some();
    Ok(WriteOutcome::Done(if wrote_anything {
        owned.len() as u64
    } else {
        0
    }))
}
