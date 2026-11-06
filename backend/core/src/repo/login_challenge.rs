//! Short-lived, single-use proofs between two requests (second login step,
//! passkey ceremonies, re-authentication). The raw token never hits the DB,
//! only its SHA-256 hash.

use uuid::Uuid;

use crate::error::CoreError;
use crate::text_enum::text_enum;

text_enum! {
    /// What a challenge proves, once used: `login_challenge.kind`.
    pub enum ChallengeKind {
        /// The second step of a password login.
        Mfa = "mfa",
        PasskeyLogin = "passkey_login",
        PasskeyRegister = "passkey_register",
        /// A fresh re-authentication before a sensitive change.
        Reauth = "reauth",
    }
}

/// How long a challenge can be used after it is issued.
pub const TTL_MINUTES: i32 = 5;

pub struct Challenge {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub kind: ChallengeKind,
    pub state: serde_json::Value,
}

/// Store a challenge that expires [`TTL_MINUTES`] from now, by the
/// database's clock. `token_hash` is unique; a collision is an error.
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

/// Look a challenge up without using it: only unexpired rows of the given
/// kind are visible.
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

/// Use a challenge exactly once: a single atomic delete, so of two concurrent
/// callers only one gets `Some`. `None` when it was already used, expired, or
/// is of another kind (a wrong-kind call leaves the row alone). Runs on a pool
/// or inside a caller's transaction (rolled back, the challenge is back).
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

/// Housekeeping: drop challenges past their expiry. Lookups already ignore
/// them; this just reclaims rows.
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

    #[sqlx::test(migrations = "../migrations")]
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

    #[sqlx::test(migrations = "../migrations")]
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

    #[sqlx::test(migrations = "../migrations")]
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

    #[sqlx::test(migrations = "../migrations")]
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
