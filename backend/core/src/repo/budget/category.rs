//! Category CRUD. The system row (`system_key = 'internal_transfer'`) is
//! deliberately protected here rather than by a delete trigger: `user_id`
//! cascades from `users`, and a raising trigger would make deleting a user
//! impossible.

use uuid::Uuid;

use crate::error::CoreError;

#[derive(Debug, Clone)]
pub struct BudgetCategoryRow {
    pub id: Uuid,
    pub name: String,
    /// Set only on seeded rows, cleared on rename — the frontend translates it.
    pub default_key: Option<String>,
    pub color: String,
    pub icon: Option<String>,
    pub hint: Option<String>,
    pub kind: String,
    pub system_key: Option<String>,
    pub archived: bool,
    /// How many of this user's transactions carry the category, all-time.
    pub tx_count: i64,
}

pub struct NewCategory<'a> {
    pub name: &'a str,
    pub color: &'a str,
    pub icon: Option<&'a str>,
    pub hint: Option<&'a str>,
    pub kind: &'a str,
}

pub struct CategoryPatch<'a> {
    pub name: &'a str,
    pub color: &'a str,
    pub icon: Option<&'a str>,
    pub hint: Option<&'a str>,
    pub kind: &'a str,
    pub archived: bool,
}

pub async fn list_categories(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<BudgetCategoryRow>, CoreError> {
    let rows = sqlx::query_as!(
        BudgetCategoryRow,
        r#"
        select c.id          as "id!",
               c.name        as "name!",
               c.default_key,
               c.color       as "color!",
               c.icon,
               c.hint,
               c.kind        as "kind!",
               c.system_key,
               (c.archived_at is not null) as "archived!",
               coalesce(n.cnt, 0) as "tx_count!"
        from budget_category c
        left join (
            select t.budget_category_id as cid, count(*) as cnt
            from transaction t
            join account a    on a.id = t.account_id
            join connection k on k.id = a.connection_id
            where k.user_id = $1
            group by t.budget_category_id
        ) n on n.cid = c.id
        where c.user_id = $1
        order by case c.kind
                     when 'expense' then 0
                     when 'income' then 1
                     when 'internal' then 2
                     else 3
                 end,
                 c.sort_order, lower(c.name)
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// What a category chip needs, without the per-category transaction count
/// `list_categories` pays for.
#[derive(Debug, Clone)]
pub struct CategoryRef {
    pub id: Uuid,
    pub name: String,
    pub default_key: Option<String>,
    pub color: String,
    pub icon: Option<String>,
}

pub async fn category_refs(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<CategoryRef>, CoreError> {
    let rows = sqlx::query_as!(
        CategoryRef,
        r#"
        select id, name, default_key, color, icon
        from budget_category
        where user_id = $1
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// The next position within the kind is read and written under a lock on
/// the user's row, so two categories created at once never share a number.
pub async fn create_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    new: &NewCategory<'_>,
) -> Result<BudgetCategoryRow, CoreError> {
    let mut tx = pool.begin().await?;
    // `no key update`: enough to serialise category creation per user, and
    // unlike `for update` it does not block rows that merely reference the user.
    sqlx::query!(
        "select 1 as x from users where id = $1 for no key update",
        user_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    let row = sqlx::query_as!(
        BudgetCategoryRow,
        r#"
        insert into budget_category (user_id, name, color, icon, hint, kind, sort_order)
        values ($1, $2, $3, $4, $5, $6,
                coalesce((select max(sort_order) from budget_category
                          where user_id = $1 and kind = $6), 0) + 1)
        returning id        as "id!",
                  name      as "name!",
                  default_key,
                  color     as "color!",
                  icon,
                  hint,
                  kind      as "kind!",
                  system_key,
                  (archived_at is not null) as "archived!",
                  0::bigint as "tx_count!"
        "#,
        user_id,
        new.name,
        new.color,
        new.icon,
        new.hint,
        new.kind,
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(row)
}

/// `None` means "not yours, or gone". A system row keeps its `kind` and can
/// never be archived; a rename clears `default_key`.
pub async fn update_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
    patch: &CategoryPatch<'_>,
) -> Result<Option<BudgetCategoryRow>, CoreError> {
    let row = sqlx::query_as!(
        BudgetCategoryRow,
        r#"
        update budget_category c
           set name = $3,
               color = $4,
               icon = $5,
               hint = $6,
               kind = case when c.system_key is null then $7 else c.kind end,
               archived_at = case
                   when c.system_key is not null then null
                   when $8 then coalesce(c.archived_at, now())
                   else null
               end,
               default_key = case when c.name = $3 then c.default_key else null end
         where c.id = $1 and c.user_id = $2
        returning c.id        as "id!",
                  c.name      as "name!",
                  c.default_key,
                  c.color     as "color!",
                  c.icon,
                  c.hint,
                  c.kind      as "kind!",
                  c.system_key,
                  (c.archived_at is not null) as "archived!",
                  (select count(*)
                     from transaction t
                     join account a    on a.id = t.account_id
                     join connection k on k.id = a.connection_id
                    where k.user_id = $2 and t.budget_category_id = c.id) as "tx_count!"
        "#,
        id,
        user_id,
        patch.name,
        patch.color,
        patch.icon,
        patch.hint,
        patch.kind,
        patch.archived,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

#[derive(Debug, PartialEq, Eq)]
pub enum DeleteCategory {
    Deleted,
    /// Not this user's row, or already gone.
    NotFound,
    /// The protected system row.
    System,
}

/// Deletes one category. Its transactions survive — `on delete set null`
/// sends them back to uncategorised.
pub async fn delete_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<DeleteCategory, CoreError> {
    // One transaction: the delete and the renumbering that closes the hole it
    // leaves have to be one step, or a concurrent reorder could interleave.
    let mut tx = pool.begin().await?;
    let system = sqlx::query_scalar!(
        r#"
        select (system_key is not null) as "system!"
        from budget_category where id = $1 and user_id = $2
        for update
        "#,
        id,
        user_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    match system {
        None => return Ok(DeleteCategory::NotFound),
        Some(true) => return Ok(DeleteCategory::System),
        Some(false) => {}
    }
    sqlx::query!(
        "delete from budget_category where id = $1 and user_id = $2",
        id,
        user_id,
    )
    .execute(&mut *tx)
    .await?;
    compact_sort_order(&mut tx, user_id).await?;
    tx.commit().await?;
    Ok(DeleteCategory::Deleted)
}

/// Renumbers every kind back to `1..n`, keeping the order the rows are already
/// in. Called after a delete so the numbers never grow holes.
async fn compact_sort_order(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"
        update budget_category c
           set sort_order = r.ord::int
          from (
              select id,
                     row_number() over (partition by kind order by sort_order, lower(name)) as ord
                from budget_category
               where user_id = $1
          ) r
         where r.id = c.id and c.sort_order <> r.ord::int
        "#,
        user_id,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Rewrites the order of the ids given, numbering each kind `1, 2, 3…` in the
/// order supplied. The caller sends the whole list, kinds interleaved or not;
/// the numbering is re-derived per kind here, so two adjacent rows changing
/// places is exactly their two numbers swapping.
///
/// Ids that are not this user's are silently skipped — the caller compares the
/// returned count against what it sent and refuses a partial write. The ids
/// must be distinct; the caller refuses duplicates.
pub async fn reorder_categories(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    ids: &[Uuid],
) -> Result<u64, CoreError> {
    let done = sqlx::query!(
        r#"
        update budget_category c
           set sort_order = r.ord::int
          from (
              select t.id,
                     row_number() over (partition by b.kind order by t.ord) as ord
                from unnest($2::uuid[]) with ordinality as t(id, ord)
                join budget_category b on b.id = t.id and b.user_id = $1
          ) r
         where r.id = c.id
        "#,
        user_id,
        ids,
    )
    .execute(pool)
    .await?
    .rows_affected();
    Ok(done)
}
