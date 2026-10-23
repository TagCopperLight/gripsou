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

#[sqlx::test(migrations = "../migrations")]
async fn welcome_starts_pending_and_finishing_is_idempotent(pool: PgPool) -> anyhow::Result<()> {
    let id = gripsou_core::testkit::seed_user(&pool).await;

    let profile = gripsou_core::repo::user::profile_by_id(&pool, id)
        .await?
        .unwrap();
    assert!(
        !profile.welcome_done,
        "a new account has not seen the welcome yet"
    );

    assert!(gripsou_core::repo::user::finish_welcome(&pool, id).await?);
    let first: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("select welcomed_at from users where id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    assert!(
        gripsou_core::repo::user::profile_by_id(&pool, id)
            .await?
            .unwrap()
            .welcome_done
    );

    assert!(gripsou_core::repo::user::finish_welcome(&pool, id).await?);
    let second: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("select welcomed_at from users where id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(first, second, "finishing twice keeps the first date");

    assert!(!gripsou_core::repo::user::finish_welcome(&pool, uuid::Uuid::new_v4()).await?);
    Ok(())
}
