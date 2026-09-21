//! Tag CRUD. A tag is free-form and cross-cutting: unlike a category it is
//! never summed and never exclusive, so it carries no kind and no hint.

use uuid::Uuid;

use crate::error::CoreError;

#[derive(Debug, Clone)]
pub struct BudgetTagRow {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub tx_count: i64,
}

pub async fn list_tags(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<BudgetTagRow>, CoreError> {
    let rows = sqlx::query_as!(
        BudgetTagRow,
        r#"
        select g.id   as "id!",
               g.name as "name!",
               g.color,
               (select count(*) from budget_transaction_tag tt where tt.tag_id = g.id) as "tx_count!"
        from budget_tag g
        where g.user_id = $1
        order by g.created_at, g.name
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn create_tag(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    name: &str,
    color: Option<&str>,
) -> Result<BudgetTagRow, CoreError> {
    let row = sqlx::query_as!(
        BudgetTagRow,
        r#"
        insert into budget_tag (user_id, name, color)
        values ($1, $2, $3)
        returning id as "id!", name as "name!", color, 0::bigint as "tx_count!"
        "#,
        user_id,
        name,
        color,
    )
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub async fn update_tag(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    id: Uuid,
    name: &str,
    color: Option<&str>,
) -> Result<Option<BudgetTagRow>, CoreError> {
    let row = sqlx::query_as!(
        BudgetTagRow,
        r#"
        update budget_tag
           set name = $3, color = $4
         where id = $1 and user_id = $2
        returning id as "id!", name as "name!", color,
                  (select count(*) from budget_transaction_tag tt where tt.tag_id = budget_tag.id) as "tx_count!"
        "#,
        id,
        user_id,
        name,
        color,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Deleting a tag removes it from every transaction (the join table cascades)
/// and nothing else: no aggregate has ever counted it.
pub async fn delete_tag(pool: &sqlx::PgPool, user_id: Uuid, id: Uuid) -> Result<bool, CoreError> {
    let done = sqlx::query!(
        "delete from budget_tag where id = $1 and user_id = $2",
        id,
        user_id,
    )
    .execute(pool)
    .await?;
    Ok(done.rows_affected() > 0)
}
