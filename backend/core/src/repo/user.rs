//! Credential lookups for authentication. Read-only helpers + a password
//! update, all taking the pool (interactive API calls, not sync transactions).

use uuid::Uuid;

use crate::error::CoreError;
use crate::repo::prefs::UserPrefs;

/// Row needed to authenticate a login: the hash to verify plus the profile the
/// client needs to render the session.
pub struct UserCredentials {
    pub id: Uuid,
    pub password_hash: String,
    pub name: String,
    pub email: String,
    pub role: String,
    pub prefs: UserPrefs,
}

pub async fn credentials_by_email(
    pool: &sqlx::PgPool,
    email: &str,
) -> Result<Option<UserCredentials>, CoreError> {
    let row = sqlx::query!(
        r#"select id, password_hash, name, email, role,
                  prefs as "prefs!: sqlx::types::Json<UserPrefs>"
           from users where email = $1"#,
        email,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| UserCredentials {
        id: r.id,
        password_hash: r.password_hash,
        name: r.name,
        email: r.email,
        role: r.role,
        prefs: r.prefs.0,
    }))
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

/// The current user's own profile, fetched by id for the /auth/me bootstrap.
#[derive(Debug)]
pub struct UserProfile {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
    pub prefs: UserPrefs,
}

pub async fn profile_by_id(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Option<UserProfile>, CoreError> {
    let row = sqlx::query!(
        r#"select id, name, email, role,
                  prefs as "prefs!: sqlx::types::Json<UserPrefs>"
           from users where id = $1"#,
        user_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| UserProfile {
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        prefs: r.prefs.0,
    }))
}

/// Number of users with the `admin` role. Used to refuse deleting the last
/// admin, which would lock everyone out of admin-only settings.
pub async fn count_admins(pool: &sqlx::PgPool) -> Result<i64, CoreError> {
    let n = sqlx::query_scalar!(r#"select count(*) from users where role = 'admin'"#)
        .fetch_one(pool)
        .await?;
    Ok(n.unwrap_or(0))
}

/// Permanently delete a user. FK `on delete cascade` removes their sessions,
/// connections, accounts, holdings and snapshots. Returns true when a row was
/// deleted (the user existed).
pub async fn delete_user(pool: &sqlx::PgPool, user_id: Uuid) -> Result<bool, CoreError> {
    let res = sqlx::query!(r#"delete from users where id = $1"#, user_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() == 1)
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
    let row = sqlx::query!(
        r#"update users set name = $2, email = $3 where id = $1
           returning id, name, email, role,
                     prefs as "prefs!: sqlx::types::Json<UserPrefs>""#,
        user_id,
        name,
        email,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| UserProfile {
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        prefs: r.prefs.0,
    }))
}

/// Replace the user's prefs blob, returning the refreshed profile (or `None`
/// when the user no longer exists).
pub async fn update_prefs(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    prefs: &UserPrefs,
) -> Result<Option<UserProfile>, CoreError> {
    let row = sqlx::query!(
        r#"update users set prefs = $2 where id = $1
           returning id, name, email, role,
                     prefs as "prefs!: sqlx::types::Json<UserPrefs>""#,
        user_id,
        sqlx::types::Json(prefs) as _,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| UserProfile {
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        prefs: r.prefs.0,
    }))
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

    #[sqlx::test(migrations = "../migrations")]
    async fn lookup_update_roundtrip(pool: PgPool) -> anyhow::Result<()> {
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, 'a@t.local', 'Ann', 'hash-1', 'admin')",
        )
        .bind(id)
        .execute(&pool)
        .await?;

        let creds = credentials_by_email(&pool, "a@t.local").await?.unwrap();
        assert_eq!(creds.id, id);
        assert_eq!(creds.password_hash, "hash-1");
        assert_eq!(creds.role, "admin");

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

    #[sqlx::test(migrations = "../migrations")]
    async fn profile_returns_default_prefs_for_empty_jsonb(pool: PgPool) -> anyhow::Result<()> {
        let id = Uuid::new_v4();
        // No prefs column set -> DB default '{}'.
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, 'p@t.local', 'Pia', 'hash', 'user')",
        )
        .bind(id)
        .execute(&pool)
        .await?;

        let profile = profile_by_id(&pool, id).await?.unwrap();
        assert_eq!(profile.prefs.ui_language, "en");
        assert_eq!(profile.prefs.currency_symbol, "€");

        let creds = credentials_by_email(&pool, "p@t.local").await?.unwrap();
        assert_eq!(creds.prefs.number_decimal_sep, ",");
        Ok(())
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_profile_roundtrip_and_conflict(pool: PgPool) -> anyhow::Result<()> {
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, 'a@t.local', 'Ann', 'hash', 'admin')",
        )
        .bind(id)
        .execute(&pool)
        .await?;
        // A second user whose email we must not be able to collide with.
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, 'taken@t.local', 'Bob', 'hash', 'user')",
        )
        .bind(Uuid::new_v4())
        .execute(&pool)
        .await?;

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
