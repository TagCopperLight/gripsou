//! Credential lookups for authentication. Read-only helpers + a password
//! update, all taking the pool (interactive API calls, not sync transactions).

use uuid::Uuid;

use crate::error::CoreError;

/// Row needed to authenticate a login: the hash to verify plus the profile the
/// client needs to render the session.
pub struct UserCredentials {
    pub id: Uuid,
    pub password_hash: String,
    pub name: String,
    pub email: String,
    pub role: String,
}

pub async fn credentials_by_email(
    pool: &sqlx::PgPool,
    email: &str,
) -> Result<Option<UserCredentials>, CoreError> {
    let row = sqlx::query_as!(
        UserCredentials,
        r#"select id, password_hash, name, email, role
           from users where email = $1"#,
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

/// The current user's own profile, fetched by id for the /auth/me bootstrap.
pub struct UserProfile {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
}

pub async fn profile_by_id(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Option<UserProfile>, CoreError> {
    let row = sqlx::query_as!(
        UserProfile,
        r#"select id, name, email, role from users where id = $1"#,
        user_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
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
}
