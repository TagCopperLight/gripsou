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
    pub sort_order: i32,
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
               c.sort_order  as "sort_order!",
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
                 c.sort_order, c.name
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn create_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    new: &NewCategory<'_>,
) -> Result<BudgetCategoryRow, CoreError> {
    let row = sqlx::query_as!(
        BudgetCategoryRow,
        r#"
        insert into budget_category (user_id, name, color, icon, hint, kind, sort_order)
        values ($1, $2, $3, $4, $5, $6,
                coalesce((select max(sort_order) + 10 from budget_category
                          where user_id = $1 and kind = $6), 10))
        returning id        as "id!",
                  name      as "name!",
                  default_key,
                  color     as "color!",
                  icon,
                  hint,
                  kind      as "kind!",
                  system_key,
                  sort_order as "sort_order!",
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
    .fetch_one(pool)
    .await?;
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
                  c.sort_order as "sort_order!",
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

/// `false` means nothing was deleted: not this user's row, already gone, or the
/// protected system row. Its transactions survive — `on delete set null` sends
/// them back to uncategorised.
pub async fn delete_category(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<bool, CoreError> {
    let done = sqlx::query!(
        "delete from budget_category where id = $1 and user_id = $2 and system_key is null",
        id,
        user_id,
    )
    .execute(pool)
    .await?;
    Ok(done.rows_affected() > 0)
}
