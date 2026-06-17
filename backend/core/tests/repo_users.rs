mod common;

use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn lists_users_oldest_first(pool: PgPool) -> anyhow::Result<()> {
    sqlx::query(
        "insert into users (email, name, password_hash, role, created_at) \
         values ('admin@t.local','Admin','x','admin', now() - interval '10 days')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "insert into users (email, name, password_hash, role, created_at) \
         values ('m1@t.local','Member One','x','user', now() - interval '5 days')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "insert into users (email, name, password_hash, role, created_at) \
         values ('m2@t.local','Member Two','x','user', now() - interval '1 day')",
    )
    .execute(&pool)
    .await?;

    let users = gripsou_core::repo::query::users(&pool).await?;
    assert_eq!(users.len(), 3, "all three users returned");
    assert_eq!(users[0].email, "admin@t.local", "oldest (admin) first");
    assert_eq!(users[0].role, "admin");
    assert_eq!(users[2].email, "m2@t.local", "newest last");
    Ok(())
}
