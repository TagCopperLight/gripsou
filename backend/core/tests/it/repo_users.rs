use gripsou_core::repo::user::Role;
use sqlx::PgPool;

#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
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

    let users = gripsou_core::repo::user::list(&pool).await?;
    assert_eq!(users.len(), 3, "all three users returned");
    assert_eq!(users[0].email, "admin@t.local", "oldest (admin) first");
    assert_eq!(users[0].role, Role::Admin);
    assert_eq!(users[2].email, "m2@t.local", "newest last");
    Ok(())
}

#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
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

/// One admin removed while the only other one is being removed: the second
/// removal waits for the first, then refuses, so the server keeps an admin.
#[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
async fn the_last_two_admins_removed_at_once_leave_one(pool: PgPool) -> anyhow::Result<()> {
    use gripsou_core::repo::user::{AdminGuarded, delete_user, set_role};
    use gripsou_core::testkit::seed_user_as;
    let admins = || async {
        sqlx::query_scalar::<_, i64>("select count(*) from users where role = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap()
    };
    let a = seed_user_as(&pool, "a@t.local", Role::Admin, "x").await;

    for removal in ["delete", "demote"] {
        let other = seed_user_as(&pool, &format!("{removal}@t.local"), Role::Admin, "x").await;
        let mut first = pool.begin().await?;
        sqlx::query("delete from users where id = $1")
            .bind(other)
            .execute(&mut *first)
            .await?;
        let second = tokio::spawn({
            let pool = pool.clone();
            async move {
                match removal {
                    "delete" => delete_user(&pool, a).await,
                    _ => set_role(&pool, a, Role::User).await,
                }
            }
        });
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        assert!(
            !second.is_finished(),
            "{removal} waits for the first removal"
        );
        first.commit().await?;
        assert_eq!(second.await??, AdminGuarded::LastAdmin, "{removal}");
        assert_eq!(admins().await, 1, "{removal}");
    }
    Ok(())
}
