//! Invite / password-reset tokens. The raw token is never stored — only its
//! SHA-256 hash (base64url) — mirroring session tokens. Rows expire (24h) and
//! are single-use (`used_at`).

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::CoreError;

/// Insert a one-time token. `kind` is `"invite"` or `"reset"`; `email` is the
/// target user's email for resets, `None` for invites (the invitee chooses it).
pub async fn create(
    pool: &sqlx::PgPool,
    kind: &str,
    email: Option<&str>,
    created_by: Uuid,
    token: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"insert into invite_token (token, type, email, created_by, expires_at)
           values ($1, $2, $3, $4, $5)"#,
        token,
        kind,
        email,
        created_by,
        expires_at,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use sqlx::PgPool;

    async fn seed_admin(pool: &PgPool) -> Uuid {
        sqlx::query_scalar::<_, Uuid>(
            "insert into users (email, name, password_hash, role)
             values ('a@t.local', 'A', 'x', 'admin') returning id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn create_inserts_invite_row(pool: PgPool) {
        let admin = seed_admin(&pool).await;
        create(
            &pool,
            "invite",
            None,
            admin,
            "hashed-token",
            Utc::now() + Duration::hours(24),
        )
        .await
        .unwrap();

        let (kind, email): (String, Option<String>) =
            sqlx::query_as("select type, email from invite_token where token = 'hashed-token'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(kind, "invite");
        assert_eq!(email, None);
    }
}
