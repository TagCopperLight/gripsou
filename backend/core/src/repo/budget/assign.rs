//! What a user does to one transaction, or to many at once.
//!
//! Every write here is `category_source = 'user'`: it outranks every pipeline stage and joins the AI's example
//! pool. Clearing a category nulls the source too. A category write that makes a row count unlinks both
//! halves of every pair it touches, unless the new category is neutral (CLAUDE.md, Budget).
//!
//! [`patch_transaction`], [`bulk_apply`] and [`apply_to_description`] each run as one database transaction
//! under the user's write lock: lock the target rows ([`lock_owned`]), check the category and tags ([`gate`]),
//! ask for confirmation before dissolving a pair, then write. A refused request writes nothing.

use rust_decimal::Decimal;
use uuid::Uuid;

use crate::budget::vocab::{CategoryKind, CategorySource};
use crate::db::UserWriteTx;
use crate::error::CoreError;

#[derive(Debug, PartialEq, Eq)]
pub enum WriteOutcome<T> {
    Done(T),
    /// Nothing was written: this many target rows are half of a pair the write would unlink, and the caller
    /// has not confirmed.
    PendingPairBreaks(i64),
    Refused(Refusal),
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    NotFound,
    UnknownCategory,
    UnknownTag,
}

/// Only [`lock_owned`] makes one, so every writer writes rows whose ownership was checked once.
struct Locked {
    rows: Vec<(Uuid, bool)>,
}

impl Locked {
    fn ids(&self) -> Vec<Uuid> {
        self.rows.iter().map(|(id, _)| *id).collect()
    }

    fn paired(&self) -> i64 {
        self.rows.iter().filter(|(_, paired)| *paired).count() as i64
    }
}

/// A sync that pairs one of them waits until the write commits, so the pair check still holds.
async fn lock_owned(tx: &mut UserWriteTx<'_>, ids: &[Uuid]) -> Result<Locked, CoreError> {
    let rows = sqlx::query!(
        r#"
        select t.id as "id!", (t.transfer_pair_id is not null) as "paired!"
        from transaction t
        where t.id = any($1)
          and t.id in (select id from user_transactions($2))
        order by t.id
        for update of t
        "#,
        ids,
        tx.user_id(),
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(Locked {
        rows: rows.into_iter().map(|r| (r.id, r.paired)).collect(),
    })
}

struct CategoryWrite {
    category_id: Option<Uuid>,
    /// A neutral category counts toward nothing, as a pair does, so filing one half under it changes no total and
    /// the pair stands. Clearing does not keep pairs.
    keeps_pairs: bool,
}

impl CategoryWrite {
    fn clear() -> Self {
        CategoryWrite {
            category_id: None,
            keeps_pairs: false,
        }
    }

    /// Locks the category row so a concurrent delete cannot slip in before the write.
    async fn check(
        tx: &mut UserWriteTx<'_>,
        category_id: Option<Uuid>,
    ) -> Result<Option<Self>, CoreError> {
        let Some(id) = category_id else {
            return Ok(Some(Self::clear()));
        };
        let kind = sqlx::query_scalar!(
            r#"
            select kind as "kind: CategoryKind"
            from budget_category
            where id = $1 and user_id = $2
            for share
            "#,
            id,
            tx.user_id(),
        )
        .fetch_optional(&mut **tx)
        .await?;
        Ok(kind.map(|kind| CategoryWrite {
            category_id: Some(id),
            keeps_pairs: kind == CategoryKind::Neutral,
        }))
    }

    /// Unlinks every pair they take part in, both halves, unless the category keeps pairs. Returns the ids
    /// written.
    async fn write(&self, tx: &mut UserWriteTx<'_>, rows: &Locked) -> Result<Vec<Uuid>, CoreError> {
        let ids = rows.ids();
        sqlx::query!(
            r#"
            update transaction t
               set budget_category_id = $2,
                   category_source = $3,
                   category_confidence = null,
                   category_reviewed_at = case when $2::uuid is null then null else now() end
             where t.id = any($1)
            "#,
            &ids,
            self.category_id,
            self.category_id.map(|_| CategorySource::User) as Option<CategorySource>,
        )
        .execute(&mut **tx)
        .await?;
        if !self.keeps_pairs && rows.paired() > 0 {
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
                &ids,
            )
            .execute(&mut **tx)
            .await?;
        }
        Ok(ids)
    }
}

async fn tags_are_mine(tx: &mut UserWriteTx<'_>, tag_ids: &[Uuid]) -> Result<bool, CoreError> {
    let mut wanted = tag_ids.to_vec();
    wanted.sort();
    wanted.dedup();
    if wanted.is_empty() {
        return Ok(true);
    }
    let found = sqlx::query_scalar!(
        "select id from budget_tag where id = any($1) and user_id = $2 for share",
        &wanted,
        tx.user_id(),
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(found.len() == wanted.len())
}

enum Gate<T> {
    Go(Option<CategoryWrite>),
    Stop(WriteOutcome<T>),
}

/// Tags and ✓ break no pairs, so a call with no category is never held for confirmation.
async fn gate<T>(
    tx: &mut UserWriteTx<'_>,
    rows: &Locked,
    category_id: Option<Option<Uuid>>,
    tag_ids: Option<&[Uuid]>,
    confirm_break_pairs: bool,
) -> Result<Gate<T>, CoreError> {
    let category = match category_id {
        None => None,
        Some(id) => match CategoryWrite::check(tx, id).await? {
            Some(c) => Some(c),
            None => return Ok(Gate::Stop(WriteOutcome::Refused(Refusal::UnknownCategory))),
        },
    };
    if let Some(tag_ids) = tag_ids
        && !tags_are_mine(tx, tag_ids).await?
    {
        return Ok(Gate::Stop(WriteOutcome::Refused(Refusal::UnknownTag)));
    }
    let breaks = rows.paired();
    if let Some(c) = &category
        && !c.keeps_pairs
        && breaks > 0
        && !confirm_break_pairs
    {
        return Ok(Gate::Stop(WriteOutcome::PendingPairBreaks(breaks)));
    }
    Ok(Gate::Go(category))
}

impl<T> WriteOutcome<T> {
    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> WriteOutcome<U> {
        match self {
            WriteOutcome::Done(t) => WriteOutcome::Done(f(t)),
            WriteOutcome::PendingPairBreaks(n) => WriteOutcome::PendingPairBreaks(n),
            WriteOutcome::Refused(r) => WriteOutcome::Refused(r),
        }
    }
}

/// As if the user cleared each row: they go back to the AI, review and pairing, and their pairs are
/// unlinked. Run before the category is deleted.
pub(crate) async fn clear_category(
    tx: &mut UserWriteTx<'_>,
    category_id: Uuid,
) -> Result<(), CoreError> {
    let ids = sqlx::query_scalar!(
        r#"
        select t.id as "id!"
        from user_transactions($1) t
        where t.budget_category_id = $2
        "#,
        tx.user_id(),
        category_id,
    )
    .fetch_all(&mut **tx)
    .await?;
    let rows = lock_owned(tx, &ids).await?;
    CategoryWrite::clear().write(tx, &rows).await?;
    Ok(())
}

async fn replace_tags(
    tx: &mut UserWriteTx<'_>,
    txn_id: Uuid,
    tag_ids: &[Uuid],
) -> Result<(), CoreError> {
    sqlx::query!(
        "delete from budget_transaction_tag where transaction_id = $1",
        txn_id
    )
    .execute(&mut **tx)
    .await?;
    sqlx::query!(
        r#"
        insert into budget_transaction_tag (transaction_id, tag_id)
        select $1, unnest($2::uuid[])
        on conflict do nothing
        "#,
        txn_id,
        tag_ids,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn add_tags(
    tx: &mut UserWriteTx<'_>,
    rows: &Locked,
    tag_ids: &[Uuid],
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        insert into budget_transaction_tag (transaction_id, tag_id)
        select t, g from unnest($1::uuid[]) t cross join unnest($2::uuid[]) g
        on conflict do nothing
        "#,
        &rows.ids(),
        tag_ids,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn write_checked(
    tx: &mut UserWriteTx<'_>,
    rows: &Locked,
    checked: bool,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        update transaction t
           set checked_at = case when $2 then now() else null end
         where t.id = any($1)
        "#,
        &rows.ids(),
        checked,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// `None` leaves a field alone; `category_id: Some(None)` clears it.
#[derive(Default)]
pub struct TransactionPatch<'a> {
    pub category_id: Option<Option<Uuid>>,
    pub tag_ids: Option<&'a [Uuid]>,
    pub checked: Option<bool>,
}

/// Category, tags and ✓ together or not at all.
pub async fn patch_transaction(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    patch: &TransactionPatch<'_>,
    confirm_break_pairs: bool,
) -> Result<WriteOutcome<()>, CoreError> {
    let mut tx = crate::db::begin_user_writes(pool, user_id).await?;
    let rows = lock_owned(&mut tx, &[txn_id]).await?;
    if rows.rows.is_empty() {
        return Ok(WriteOutcome::Refused(Refusal::NotFound));
    }
    let category = match gate(
        &mut tx,
        &rows,
        patch.category_id,
        patch.tag_ids,
        confirm_break_pairs,
    )
    .await?
    {
        Gate::Go(category) => category,
        Gate::Stop(outcome) => return Ok(outcome),
    };
    if let Some(category) = category {
        category.write(&mut tx, &rows).await?;
    }
    if let Some(tag_ids) = patch.tag_ids {
        replace_tags(&mut tx, txn_id, tag_ids).await?;
    }
    if let Some(checked) = patch.checked {
        write_checked(&mut tx, &rows, checked).await?;
    }
    tx.commit().await?;
    Ok(WriteOutcome::Done(()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SameDescription {
    All,
    /// Only rows still in the review queue at this threshold, never the anchor: from the queue, a correction
    /// must not overwrite what the user already settled.
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

pub async fn count_same_description(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    scope: SameDescription,
) -> Result<i64, CoreError> {
    let ids = same_description_ids(pool, user_id, txn_id, scope).await?;
    Ok(ids.iter().filter(|&&id| id != txn_id).count() as i64)
}

/// Guards on the normalised value, not the raw one: `description_norm` collapses runs of 2+ digits, so a raw
/// `"12345"` normalises to `''`. Such a row has no merchant identity and never clusters: the inner subquery
/// yields NULL and nothing matches.
async fn same_description_ids<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    user_id: Uuid,
    txn_id: Uuid,
    scope: SameDescription,
) -> Result<Vec<Uuid>, CoreError> {
    let ids = sqlx::query_scalar!(
        r#"
        select t.id as "id!"
        from user_transactions($2) t
        where t.description_norm <> ''
          and t.description_norm = (
              select a.description_norm
              from user_transactions($2) a
              where a.id = $1 and a.description_norm <> ''
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
    .fetch_all(executor)
    .await?;
    Ok(ids)
}

/// Returns the ids written (the row itself included under [`SameDescription::All`]); the review queue needs
/// to know which of its lines this resolved.
pub async fn apply_to_description(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    txn_id: Uuid,
    category_id: Option<Uuid>,
    scope: SameDescription,
    confirm_break_pairs: bool,
) -> Result<WriteOutcome<Vec<Uuid>>, CoreError> {
    let mut tx = crate::db::begin_user_writes(pool, user_id).await?;
    if lock_owned(&mut tx, &[txn_id]).await?.rows.is_empty() {
        return Ok(WriteOutcome::Refused(Refusal::NotFound));
    }
    let ids = same_description_ids(&mut *tx, user_id, txn_id, scope).await?;
    let rows = lock_owned(&mut tx, &ids).await?;
    let written = match gate(&mut tx, &rows, Some(category_id), None, confirm_break_pairs).await? {
        Gate::Go(Some(category)) => category.write(&mut tx, &rows).await?,
        Gate::Go(None) => vec![],
        Gate::Stop(outcome) => return Ok(outcome),
    };
    tx.commit().await?;
    Ok(WriteOutcome::Done(written))
}

/// `category_id: None` leaves the category alone, `Some(None)` clears it.
#[derive(Default)]
pub struct BulkChanges<'a> {
    pub category_id: Option<Option<Uuid>>,
    pub add_tag_ids: Option<&'a [Uuid]>,
    pub checked: Option<bool>,
}

/// Returns how many of the user's rows it covered. "Select all shown" resolves server-side and can hold rows
/// the client never loaded, so the pairs a category write breaks are counted here, on the locked rows.
pub async fn bulk_apply(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    ids: &[Uuid],
    changes: BulkChanges<'_>,
    confirm_break_pairs: bool,
) -> Result<WriteOutcome<u64>, CoreError> {
    let add_tag_ids = changes.add_tag_ids.filter(|t| !t.is_empty());
    let mut tx = crate::db::begin_user_writes(pool, user_id).await?;
    let rows = lock_owned(&mut tx, ids).await?;
    let category = match gate(
        &mut tx,
        &rows,
        changes.category_id,
        add_tag_ids,
        confirm_break_pairs,
    )
    .await?
    {
        Gate::Go(category) => category,
        Gate::Stop(outcome) => return Ok(outcome),
    };
    if let Some(category) = &category {
        category.write(&mut tx, &rows).await?;
    }
    if let Some(tag_ids) = add_tag_ids {
        add_tags(&mut tx, &rows, tag_ids).await?;
    }
    if let Some(checked) = changes.checked {
        write_checked(&mut tx, &rows, checked).await?;
    }
    tx.commit().await?;
    // Every arm covers the same locked rows, so that is the count, not a sum of arms.
    let wrote_anything = category.is_some() || add_tag_ids.is_some() || changes.checked.is_some();
    Ok(WriteOutcome::Done(if wrote_anything {
        rows.rows.len() as u64
    } else {
        0
    }))
}
