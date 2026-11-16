//! Only the SHA-256 hash of the raw token reaches the DB.

use uuid::Uuid;

use crate::error::CoreError;
use crate::text_enum::text_enum;

text_enum! {
    pub enum ChallengeKind {
        Mfa = "mfa",
        PasskeyLogin = "passkey_login",
        PasskeyRegister = "passkey_register",
        Reauth = "reauth",
    }
}

pub const TTL_MINUTES: i32 = 5;

pub struct Challenge {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub kind: ChallengeKind,
    pub state: serde_json::Value,
}

/// Expiry uses the database's clock.
pub async fn create(
    pool: &sqlx::PgPool,
    token_hash: &[u8],
    user_id: Option<Uuid>,
    kind: ChallengeKind,
    state: serde_json::Value,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"insert into login_challenge (token_hash, user_id, kind, state, expires_at)
           values ($1, $2, $3, $4, now() + make_interval(mins => $5))"#,
        token_hash,
        user_id,
        kind as ChallengeKind,
        state,
        TTL_MINUTES,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn find_valid(
    pool: &sqlx::PgPool,
    token_hash: &[u8],
    kind: ChallengeKind,
) -> Result<Option<Challenge>, CoreError> {
    let row = sqlx::query_as!(
        Challenge,
        r#"select id, user_id, kind as "kind: ChallengeKind", state
           from login_challenge
           where token_hash = $1 and kind = $2 and expires_at > now()"#,
        token_hash,
        kind as ChallengeKind,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// A single atomic delete: of two concurrent callers only one gets `Some`. A wrong-kind call
/// leaves the row alone.
pub async fn consume(
    db: impl sqlx::PgExecutor<'_>,
    token_hash: &[u8],
    kind: ChallengeKind,
) -> Result<Option<Challenge>, CoreError> {
    let row = sqlx::query_as!(
        Challenge,
        r#"delete from login_challenge
           where token_hash = $1 and kind = $2 and expires_at > now()
           returning id, user_id, kind as "kind: ChallengeKind", state"#,
        token_hash,
        kind as ChallengeKind,
    )
    .fetch_optional(db)
    .await?;
    Ok(row)
}

pub async fn delete_expired(pool: &sqlx::PgPool) -> Result<u64, CoreError> {
    let res = sqlx::query!(r#"delete from login_challenge where expires_at <= now()"#)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    use crate::testkit::seed_user;

    async fn insert_expired(pool: &PgPool, hash: &[u8], kind: ChallengeKind) {
        sqlx::query(
            "insert into login_challenge (token_hash, kind, expires_at) \
             values ($1, $2, now() - interval '1 minute')",
        )
        .bind(hash)
        .bind(kind)
        .execute(pool)
        .await
        .unwrap();
    }

    #[crate::testkit::db_test]
    async fn find_valid_checks_kind(pool: PgPool) {
        let user = seed_user(&pool).await;
        create(
            &pool,
            &[1],
            Some(user),
            ChallengeKind::Mfa,
            serde_json::json!({"a": 1}),
        )
        .await
        .unwrap();
        let c = find_valid(&pool, &[1], ChallengeKind::Mfa)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(c.user_id, Some(user));
        assert_eq!(c.kind, ChallengeKind::Mfa);
        assert_eq!(c.state, serde_json::json!({"a": 1}));
        assert!(
            find_valid(&pool, &[1], ChallengeKind::Reauth)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            find_valid(&pool, &[2], ChallengeKind::Mfa)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[crate::testkit::db_test]
    async fn consume_is_single_use(pool: PgPool) {
        create(
            &pool,
            &[1],
            None,
            ChallengeKind::PasskeyLogin,
            serde_json::json!({}),
        )
        .await
        .unwrap();
        assert!(
            consume(&pool, &[1], ChallengeKind::Mfa)
                .await
                .unwrap()
                .is_none(),
            "wrong kind must not consume"
        );
        assert!(
            consume(&pool, &[1], ChallengeKind::PasskeyLogin)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            consume(&pool, &[1], ChallengeKind::PasskeyLogin)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[crate::testkit::db_test]
    async fn expired_is_invisible(pool: PgPool) {
        insert_expired(&pool, &[1], ChallengeKind::Mfa).await;
        assert!(
            find_valid(&pool, &[1], ChallengeKind::Mfa)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            consume(&pool, &[1], ChallengeKind::Mfa)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[crate::testkit::db_test]
    async fn delete_expired_removes_only_expired(pool: PgPool) {
        insert_expired(&pool, &[1], ChallengeKind::Mfa).await;
        create(&pool, &[2], None, ChallengeKind::Mfa, serde_json::json!({}))
            .await
            .unwrap();
        assert_eq!(delete_expired(&pool).await.unwrap(), 1);
        assert!(
            find_valid(&pool, &[2], ChallengeKind::Mfa)
                .await
                .unwrap()
                .is_some()
        );
    }
}
