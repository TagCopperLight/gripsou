//! Invite / password-reset tokens. The raw token is never stored — only its
//! SHA-256 hash (base64url) — mirroring session tokens. Rows expire (24h) and
//! are single-use (`used_at`).

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::repo::mfa::{self, Cleared};

use crate::error::CoreError;

/// A token that is currently redeemable: row exists, unused, unexpired.
pub struct ValidToken {
    pub token_type: String,
    pub email: Option<String>,
}

/// Look up a redeemable token by its stored (hashed) value. Read-only — does
/// not consume. `None` means unknown, expired, or already used.
pub async fn find_valid(
    pool: &sqlx::PgPool,
    token_hash: &str,
) -> Result<Option<ValidToken>, CoreError> {
    let row = sqlx::query_as!(
        ValidToken,
        r#"select type as "token_type!", email
             from invite_token
            where token = $1 and used_at is null and expires_at > now()"#,
        token_hash,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Redeem an invite token: create the user and consume the token atomically.
/// `Ok(None)` = token not valid (unknown/expired/used/wrong type) and nothing
/// changed. A duplicate email returns `Err(unique violation)` and the whole
/// transaction rolls back, so the token is left unconsumed for a retry with a
/// different address.
pub async fn redeem_invite(
    pool: &sqlx::PgPool,
    token_hash: &str,
    email: &str,
    name: &str,
    password_hash: &str,
) -> Result<Option<Uuid>, CoreError> {
    let mut tx = pool.begin().await?;
    // FOR UPDATE locks the row so two concurrent redeems can't both succeed.
    let valid = sqlx::query_scalar!(
        r#"select 1 from invite_token
            where token = $1 and type = 'invite'
              and used_at is null and expires_at > now()
            for update"#,
        token_hash,
    )
    .fetch_optional(&mut *tx)
    .await?;
    if valid.is_none() {
        return Ok(None); // tx rolls back on drop; nothing was changed.
    }
    let user_id = sqlx::query_scalar!(
        r#"insert into users (email, name, password_hash, role)
           values ($1, $2, $3, 'user') returning id"#,
        email,
        name,
        password_hash,
    )
    .fetch_one(&mut *tx)
    .await?; // unique-email violation propagates → rollback, token untouched.
    sqlx::query!(
        "update invite_token set used_at = now() where token = $1",
        token_hash,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(user_id))
}

/// Redeem a reset token: set the new password, consume the token, revoke every
/// existing session of the user and turn off their second factors, all
/// atomically. `Ok(None)` if the token is invalid or its target user has since
/// been deleted.
pub async fn redeem_reset(
    pool: &sqlx::PgPool,
    token_hash: &str,
    password_hash: &str,
) -> Result<Option<(Uuid, Cleared)>, CoreError> {
    let mut tx = pool.begin().await?;
    let email = sqlx::query_scalar!(
        r#"select email from invite_token
            where token = $1 and type = 'reset'
              and used_at is null and expires_at > now()
            for update"#,
        token_hash,
    )
    .fetch_optional(&mut *tx)
    .await?
    .flatten(); // email column is nullable; reset tokens always carry one.
    let Some(email) = email else {
        return Ok(None);
    };
    let user_id = sqlx::query_scalar!(
        "update users set password_hash = $2 where email = $1 returning id",
        email,
        password_hash,
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some(user_id) = user_id else {
        return Ok(None); // user deleted after the token was minted.
    };
    sqlx::query!(
        "update invite_token set used_at = now() where token = $1",
        token_hash,
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("delete from session where user_id = $1", user_id)
        .execute(&mut *tx)
        .await?;
    // Whoever holds a reset link has proven control the second factor was
    // meant to guard (an admin vouched for them), so the reset turns it off.
    let cleared = mfa::clear_all(&mut tx, user_id).await?;
    tx.commit().await?;
    Ok(Some((user_id, cleared)))
}

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
        crate::testkit::seed_user_as(pool, "a@t.local", "admin", "x").await
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn find_valid_returns_unused_unexpired(pool: PgPool) {
        let admin = seed_admin(&pool).await;
        create(
            &pool,
            "reset",
            Some("u@t.local"),
            admin,
            "tok-ok",
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();
        let found = find_valid(&pool, "tok-ok").await.unwrap().unwrap();
        assert_eq!(found.token_type, "reset");
        assert_eq!(found.email.as_deref(), Some("u@t.local"));

        // Unknown, expired, and used tokens all read as None.
        assert!(find_valid(&pool, "nope").await.unwrap().is_none());
        create(
            &pool,
            "invite",
            None,
            admin,
            "tok-exp",
            Utc::now() - Duration::hours(1),
        )
        .await
        .unwrap();
        assert!(find_valid(&pool, "tok-exp").await.unwrap().is_none());
        sqlx::query("update invite_token set used_at = now() where token = 'tok-ok'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(find_valid(&pool, "tok-ok").await.unwrap().is_none());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_invite_expired_token_is_none(pool: PgPool) {
        let admin = seed_admin(&pool).await;
        create(
            &pool,
            "invite",
            None,
            admin,
            "inv-3",
            Utc::now() - Duration::hours(1),
        )
        .await
        .unwrap();
        assert!(
            redeem_invite(&pool, "inv-3", "x@t.local", "X", "pw")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_clears_second_factors_of_that_user_only(pool: PgPool) {
        let admin = seed_admin(&pool).await; // a@t.local
        let other = crate::testkit::seed_user_email(&pool, "b@t.local").await;
        for (who, cred) in [(admin, 1_u8), (other, 2_u8)] {
            crate::repo::mfa::upsert_unconfirmed_totp(&pool, who, "s")
                .await
                .unwrap();
            crate::repo::mfa::confirm_totp(&pool, who, "s", 1, &[vec![cred], vec![cred + 10]])
                .await
                .unwrap();
            sqlx::query(
                "insert into user_passkey (user_id, credential_id, passkey, name) \
                 values ($1, $2, '{}', 'k')",
            )
            .bind(who)
            .bind(vec![cred])
            .execute(&pool)
            .await
            .unwrap();
        }
        create(
            &pool,
            "reset",
            Some("a@t.local"),
            admin,
            "rst-2",
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();

        let (_, cleared) = redeem_reset(&pool, "rst-2", "new-hash")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cleared.totp, 1);
        assert_eq!(cleared.recovery_codes, 2);
        assert_eq!(cleared.passkeys, 1);

        let mine = crate::repo::mfa::status(&pool, admin).await.unwrap();
        assert!(!crate::repo::mfa::has_second_factor(&mine));
        let theirs = crate::repo::mfa::status(&pool, other).await.unwrap();
        assert!(theirs.totp && theirs.passkeys == 1);
        assert_eq!(theirs.recovery_remaining, 2);
    }
}
