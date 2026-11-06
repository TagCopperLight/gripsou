//! Invite / password-reset tokens. The raw token is never stored — only its
//! SHA-256 hash (base64url) — mirroring session tokens. Rows expire
//! ([`TTL_HOURS`]) and are single-use (`used_at`).

use uuid::Uuid;

use crate::repo::mfa::{self, Cleared};
use crate::repo::user::Role;

use crate::error::CoreError;
use crate::text_enum::text_enum;

text_enum! {
    /// `invite_token.type`.
    pub enum TokenKind {
        Invite = "invite",
        /// A password reset for an existing user's email.
        Reset = "reset",
    }
}

/// How long a link stays redeemable after it is created.
pub const TTL_HOURS: i32 = 24;

/// A token that is currently redeemable: row exists, unused, unexpired.
pub struct ValidToken {
    pub token_type: TokenKind,
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
        r#"select type as "token_type!: TokenKind", email
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
            where token = $1 and type = $2
              and used_at is null and expires_at > now()
            for update"#,
        token_hash,
        TokenKind::Invite as TokenKind,
    )
    .fetch_optional(&mut *tx)
    .await?;
    if valid.is_none() {
        return Ok(None); // tx rolls back on drop; nothing was changed.
    }
    let user_id = sqlx::query_scalar!(
        r#"insert into users (email, name, password_hash, role)
           values ($1, $2, $3, $4) returning id"#,
        email,
        name,
        password_hash,
        Role::User as Role,
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
            where token = $1 and type = $2
              and used_at is null and expires_at > now()
            for update"#,
        token_hash,
        TokenKind::Reset as TokenKind,
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
    crate::repo::session::delete_all(&mut *tx, user_id, None).await?;
    // Whoever holds a reset link has proven control the second factor was
    // meant to guard (an admin vouched for them), so the reset turns it off.
    let cleared = mfa::clear_all(&mut tx, user_id).await?;
    tx.commit().await?;
    Ok(Some((user_id, cleared)))
}

/// Insert a one-time token, redeemable for [`TTL_HOURS`]. `email` is the
/// target user's email for resets, `None` for invites (the invitee chooses it).
pub async fn create(
    pool: &sqlx::PgPool,
    kind: TokenKind,
    email: Option<&str>,
    created_by: Uuid,
    token: &str,
) -> Result<(), CoreError> {
    sqlx::query!(
        r#"insert into invite_token (token, type, email, created_by, expires_at)
           values ($1, $2, $3, $4, now() + make_interval(hours => $5))"#,
        token,
        kind as TokenKind,
        email,
        created_by,
        TTL_HOURS,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    async fn expire_token(pool: &PgPool, token: &str) {
        crate::testkit::expire(pool, "invite_token", "token = $1", token.to_string()).await;
    }

    async fn seed_admin(pool: &PgPool) -> Uuid {
        crate::testkit::seed_user_as(pool, "a@t.local", Role::Admin, "x").await
    }

    #[crate::testkit::db_test]
    async fn find_valid_returns_unused_unexpired(pool: PgPool) {
        let admin = seed_admin(&pool).await;
        create(&pool, TokenKind::Reset, Some("u@t.local"), admin, "tok-ok")
            .await
            .unwrap();
        let found = find_valid(&pool, "tok-ok").await.unwrap().unwrap();
        assert_eq!(found.token_type, TokenKind::Reset);
        assert_eq!(found.email.as_deref(), Some("u@t.local"));

        // Unknown, expired, and used tokens all read as None.
        assert!(find_valid(&pool, "nope").await.unwrap().is_none());
        create(&pool, TokenKind::Invite, None, admin, "tok-exp")
            .await
            .unwrap();
        expire_token(&pool, "tok-exp").await;
        assert!(find_valid(&pool, "tok-exp").await.unwrap().is_none());
        sqlx::query("update invite_token set used_at = now() where token = 'tok-ok'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(find_valid(&pool, "tok-ok").await.unwrap().is_none());
    }

    #[crate::testkit::db_test]
    async fn redeem_invite_expired_token_is_none(pool: PgPool) {
        let admin = seed_admin(&pool).await;
        create(&pool, TokenKind::Invite, None, admin, "inv-3")
            .await
            .unwrap();
        expire_token(&pool, "inv-3").await;
        assert!(
            redeem_invite(&pool, "inv-3", "x@t.local", "X", "pw")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[crate::testkit::db_test]
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
        create(&pool, TokenKind::Reset, Some("a@t.local"), admin, "rst-2")
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
