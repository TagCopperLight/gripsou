//! The `users` row: credentials, profile, role, welcome state, and the admin
//! listing. Preferences are [`crate::repo::prefs`].

use uuid::Uuid;

use crate::error::CoreError;
use crate::repo::prefs::{self, UserPrefs};
use crate::text_enum::text_enum;

text_enum! {
    /// `users.role`. Admins configure the server and manage users.
    pub enum Role {
        Admin = "admin",
        User = "user",
    }
}

/// What a password login checks: the hash, and whose it is.
#[derive(Debug)]
pub struct UserCredentials {
    pub id: Uuid,
    pub password_hash: String,
}

pub async fn credentials_by_email(
    pool: &sqlx::PgPool,
    email: &str,
) -> Result<Option<UserCredentials>, CoreError> {
    let row = sqlx::query_as!(
        UserCredentials,
        r#"select id, password_hash from users where email = $1"#,
        email,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn password_hash(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Option<String>, CoreError> {
    let row = sqlx::query_scalar!(r#"select password_hash from users where id = $1"#, user_id,)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

/// Whether anyone has an account: first-run setup stays open until then.
pub async fn any_exists(pool: &sqlx::PgPool) -> Result<bool, CoreError> {
    let exists = sqlx::query_scalar!(r#"select exists (select 1 from users) as "exists!""#)
        .fetch_one(pool)
        .await?;
    Ok(exists)
}

/// Create the first account, as admin. `None` when any user exists already,
/// one made by hand in SQL included.
pub async fn create_first_admin(
    pool: &sqlx::PgPool,
    email: &str,
    name: &str,
    password_hash: &str,
) -> Result<Option<Uuid>, CoreError> {
    let id = sqlx::query_scalar!(
        r#"insert into users (email, name, password_hash, role)
           select $1, $2, $3, $4
           where not exists (select 1 from users)
           returning id"#,
        email,
        name,
        password_hash,
        Role::Admin as Role,
    )
    .fetch_optional(pool)
    .await?;
    Ok(id)
}

/// The current user's own profile, fetched by id for the /auth/me bootstrap.
#[derive(Debug)]
pub struct UserProfile {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: Role,
    pub prefs: UserPrefs,
    /// False until the user finished or skipped the post-invite welcome screen.
    pub welcome_done: bool,
}

pub async fn profile_by_id(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Option<UserProfile>, CoreError> {
    let Some(row) = sqlx::query!(
        r#"select id, name, email, role as "role: Role", welcomed_at is not null as "welcome_done!"
           from users where id = $1"#,
        user_id,
    )
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    let Some(prefs) = prefs::get(pool, user_id).await? else {
        return Ok(None);
    };
    Ok(Some(UserProfile {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        prefs,
        welcome_done: row.welcome_done,
    }))
}

pub struct UserRow {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: Role,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub avatar: Option<String>,
}

/// Every user on the server, oldest first (the seeded admin sorts first), for
/// the admin Users page.
pub async fn list(pool: &sqlx::PgPool) -> Result<Vec<UserRow>, CoreError> {
    let rows = sqlx::query_as!(
        UserRow,
        r#"
        select id, name, email, role as "role: Role", created_at, prefs->>'avatar' as avatar
        from users
        order by created_at
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// What a role change or a deletion did. Both refuse to leave the server
/// without an admin: nobody could reach the admin-only settings again.
#[derive(Debug, PartialEq, Eq)]
pub enum AdminGuarded {
    Done,
    NotFound,
    LastAdmin,
}

/// Lock every admin row until the transaction ends, so two admins removed at
/// once wait for each other and the second sees the first gone.
async fn lock_admins(conn: &mut sqlx::PgConnection) -> Result<Vec<Uuid>, CoreError> {
    Ok(sqlx::query_scalar!(
        "select id from users where role = $1 order by id for update",
        Role::Admin as Role,
    )
    .fetch_all(conn)
    .await?)
}

pub async fn set_role(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    role: Role,
) -> Result<AdminGuarded, CoreError> {
    let mut tx = pool.begin().await?;
    if role != Role::Admin && lock_admins(&mut tx).await? == [user_id] {
        return Ok(AdminGuarded::LastAdmin);
    }
    let res = sqlx::query!(
        "update users set role = $2 where id = $1",
        user_id,
        role as Role,
    )
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Ok(AdminGuarded::NotFound);
    }
    tx.commit().await?;
    Ok(AdminGuarded::Done)
}

/// Permanently delete a user. FK `on delete cascade` removes their sessions,
/// connections, accounts, holdings and snapshots.
pub async fn delete_user(pool: &sqlx::PgPool, user_id: Uuid) -> Result<AdminGuarded, CoreError> {
    let mut tx = pool.begin().await?;
    if lock_admins(&mut tx).await? == [user_id] {
        return Ok(AdminGuarded::LastAdmin);
    }
    let res = sqlx::query!(r#"delete from users where id = $1"#, user_id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Ok(AdminGuarded::NotFound);
    }
    tx.commit().await?;
    Ok(AdminGuarded::Done)
}

/// Update the user's display name and email, returning the refreshed profile
/// (or `None` when the user no longer exists). A duplicate email surfaces as the
/// underlying unique-violation `sqlx::Error`, which the handler maps to 409.
pub async fn update_profile(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    name: &str,
    email: &str,
) -> Result<Option<UserProfile>, CoreError> {
    sqlx::query!(
        r#"update users set name = $2, email = $3 where id = $1"#,
        user_id,
        name,
        email,
    )
    .execute(pool)
    .await?;
    profile_by_id(pool, user_id).await
}

/// Mark the welcome screen done. Keeps the first date when called again.
/// Returns true when the user exists.
pub async fn finish_welcome(pool: &sqlx::PgPool, user_id: Uuid) -> Result<bool, CoreError> {
    let res = sqlx::query!(
        r#"update users set welcomed_at = coalesce(welcomed_at, now()) where id = $1"#,
        user_id,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// Returns true when a row was updated (the user exists).
pub async fn update_password(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    new_hash: &str,
) -> Result<bool, CoreError> {
    let res = sqlx::query!(
        r#"update users set password_hash = $2 where id = $1"#,
        user_id,
        new_hash,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    #[crate::testkit::db_test]
    async fn lookup_update_roundtrip(pool: PgPool) -> anyhow::Result<()> {
        let id = crate::testkit::seed_user_as(&pool, "a@t.local", Role::Admin, "hash-1").await;

        let creds = credentials_by_email(&pool, "a@t.local").await?.unwrap();
        assert_eq!(creds.id, id);
        assert_eq!(creds.password_hash, "hash-1");

        assert!(
            credentials_by_email(&pool, "missing@t.local")
                .await?
                .is_none()
        );

        assert!(update_password(&pool, id, "hash-2").await?);
        assert_eq!(password_hash(&pool, id).await?.unwrap(), "hash-2");
        assert!(!update_password(&pool, Uuid::new_v4(), "x").await?);
        Ok(())
    }

    #[crate::testkit::db_test]
    async fn profile_returns_default_prefs_for_empty_jsonb(pool: PgPool) -> anyhow::Result<()> {
        let id = crate::testkit::seed_user_as(&pool, "p@t.local", Role::User, "hash").await;

        let profile = profile_by_id(&pool, id).await?.unwrap();
        assert_eq!(profile.prefs.display.ui_language, "en");
        assert_eq!(profile.prefs.currency, "EUR");
        assert_eq!(profile.prefs.time_zone, "Europe/Paris");
        assert_eq!(
            profile.prefs.budget_ai_threshold,
            prefs::DEFAULT_BUDGET_AI_THRESHOLD
        );
        assert_eq!(profile.prefs.display.number_decimal_sep, ",");
        Ok(())
    }

    #[crate::testkit::db_test]
    async fn update_profile_roundtrip_and_conflict(pool: PgPool) -> anyhow::Result<()> {
        let id = crate::testkit::seed_user_as(&pool, "a@t.local", Role::Admin, "hash").await;
        // A second user whose email we must not be able to collide with.
        crate::testkit::seed_user_email(&pool, "taken@t.local").await;

        let updated = update_profile(&pool, id, "Annie", "annie@t.local")
            .await?
            .unwrap();
        assert_eq!(updated.name, "Annie");
        assert_eq!(updated.email, "annie@t.local");
        let reread = profile_by_id(&pool, id).await?.unwrap();
        assert_eq!(reread.email, "annie@t.local");

        // Missing user -> None.
        assert!(
            update_profile(&pool, Uuid::new_v4(), "X", "x@t.local")
                .await?
                .is_none()
        );

        // Colliding email -> unique-violation error from the DB.
        let err = update_profile(&pool, id, "Annie", "taken@t.local")
            .await
            .unwrap_err();
        let CoreError::Db(sqlx::Error::Database(db)) = err else {
            panic!("expected a database error, got {err:?}");
        };
        assert!(db.is_unique_violation());
        Ok(())
    }
}
