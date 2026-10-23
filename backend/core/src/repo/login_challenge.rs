//! Short-lived, single-use proofs between two requests (second login step,
//! passkey ceremonies, re-authentication). The raw token never hits the DB,
//! only its SHA-256 hash.

use uuid::Uuid;

use crate::error::CoreError;

pub struct Challenge {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub kind: String,
    pub state: serde_json::Value,
}

/// Store a challenge that expires 5 minutes from now (computed in SQL, so the
/// clock is the database's). `token_hash` is unique; a collision is an error.
pub async fn create(
    pool: &sqlx::PgPool,
    token_hash: &[u8],
    user_id: Option<Uuid>,
    kind: &str,
    state: serde_json::Value,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"insert into login_challenge (token_hash, user_id, kind, state, expires_at)
           values ($1, $2, $3, $4, now() + interval '5 minutes')"#,
        token_hash,
        user_id,
        kind,
        state,
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
    kind: &str,
) -> Result<Option<Challenge>, CoreError> {
    let row = sqlx::query_as!(
        Challenge,
        r#"select id, user_id, kind, state
           from login_challenge
           where token_hash = $1 and kind = $2 and expires_at > now()"#,
        token_hash,
        kind,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Add keys to a live challenge's state without using it (the passkey
/// ceremony started on the second login step). `false` when it is gone,
/// expired or of another kind.
pub async fn merge_state(
    pool: &sqlx::PgPool,
    token_hash: &[u8],
    kind: &str,
    patch: serde_json::Value,
) -> Result<bool, CoreError> {
    let res = sqlx::query!(
        r#"update login_challenge set state = state || $3
           where token_hash = $1 and kind = $2 and expires_at > now()"#,
        token_hash,
        kind,
        patch,
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// Use a challenge exactly once: a single atomic delete, so of two concurrent
/// callers only one gets `Some`. `None` when it was already used, expired, or
/// is of another kind (a wrong-kind call leaves the row alone). Runs on a pool
/// or inside a caller's transaction (rolled back, the challenge is back).
pub async fn consume(
    db: impl sqlx::PgExecutor<'_>,
    token_hash: &[u8],
    kind: &str,
) -> Result<Option<Challenge>, CoreError> {
    let row = sqlx::query_as!(
        Challenge,
        r#"delete from login_challenge
           where token_hash = $1 and kind = $2 and expires_at > now()
           returning id, user_id, kind, state"#,
        token_hash,
        kind,
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

    async fn seed_user(pool: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, 'a@t.local', 'Ann', 'h', 'admin')",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
        id
    }

    async fn insert_expired(pool: &PgPool, hash: &[u8], kind: &str) {
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
        create(&pool, &[1], Some(user), "mfa", serde_json::json!({"a": 1}))
            .await
            .unwrap();
        let c = find_valid(&pool, &[1], "mfa").await.unwrap().unwrap();
        assert_eq!(c.user_id, Some(user));
        assert_eq!(c.kind, "mfa");
        assert_eq!(c.state, serde_json::json!({"a": 1}));
        assert!(find_valid(&pool, &[1], "reauth").await.unwrap().is_none());
        assert!(find_valid(&pool, &[2], "mfa").await.unwrap().is_none());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn consume_is_single_use(pool: PgPool) {
        create(&pool, &[1], None, "passkey_login", serde_json::json!({}))
            .await
            .unwrap();
        assert!(
            consume(&pool, &[1], "mfa").await.unwrap().is_none(),
            "wrong kind must not consume"
        );
        assert!(
            consume(&pool, &[1], "passkey_login")
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            consume(&pool, &[1], "passkey_login")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn expired_is_invisible(pool: PgPool) {
        insert_expired(&pool, &[1], "mfa").await;
        assert!(find_valid(&pool, &[1], "mfa").await.unwrap().is_none());
        assert!(consume(&pool, &[1], "mfa").await.unwrap().is_none());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_expired_removes_only_expired(pool: PgPool) {
        insert_expired(&pool, &[1], "mfa").await;
        create(&pool, &[2], None, "mfa", serde_json::json!({}))
            .await
            .unwrap();
        assert_eq!(delete_expired(&pool).await.unwrap(), 1);
        assert!(find_valid(&pool, &[2], "mfa").await.unwrap().is_some());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn merge_state_adds_keys_to_a_live_challenge_of_that_kind(pool: PgPool) {
        create(
            &pool,
            &[1],
            None,
            "mfa",
            serde_json::json!({ "remember": true }),
        )
        .await
        .unwrap();
        assert!(
            merge_state(&pool, &[1], "mfa", serde_json::json!({ "passkey": 1 }))
                .await
                .unwrap()
        );
        let c = find_valid(&pool, &[1], "mfa").await.unwrap().unwrap();
        assert_eq!(
            c.state,
            serde_json::json!({ "remember": true, "passkey": 1 })
        );
        assert!(
            !merge_state(&pool, &[1], "reauth", serde_json::json!({ "x": 1 }))
                .await
                .unwrap()
        );
        insert_expired(&pool, &[2], "mfa").await;
        assert!(
            !merge_state(&pool, &[2], "mfa", serde_json::json!({ "x": 1 }))
                .await
                .unwrap()
        );
    }
}
