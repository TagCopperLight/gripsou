//! Invite and reset links: minting one, reading it, and redeeming it for a
//! password.

use crate::error::Json;
use axum::extract::{Path, State};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::client::Client;
use crate::auth::dto;
use crate::auth::{self, password, session};
use crate::error::ApiError;
use gripsou_core::repo::invite_token::{self, TokenKind};

/// Store a new link and return its token, for the URL. `email` names the
/// account a reset is for; an invitee chooses their own.
pub async fn mint(
    pool: &PgPool,
    kind: TokenKind,
    email: Option<&str>,
    created_by: Uuid,
) -> Result<String, ApiError> {
    let token = auth::generate_token();
    invite_token::create(pool, kind, email, created_by, &auth::hash_token_str(&token)).await?;
    Ok(token)
}

/// Public: validate a token on page load so the frontend can redirect away from
/// `/invite` or `/reset` when it's invalid. 404 = unknown/expired/used.
pub async fn token_info(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> Result<Json<dto::TokenInfoResp>, ApiError> {
    let hash = auth::hash_token_str(&token);
    let info = invite_token::find_valid(&pool, &hash)
        .await?
        .ok_or(ApiError::NotFound("invalid token"))?;
    Ok(Json(dto::TokenInfoResp {
        token_type: info.token_type,
        email: info.email,
    }))
}

/// What someone creating their own account typed, checked: the email and
/// name trimmed and required, the password within the rules.
pub fn new_account_fields<'a>(
    email: &'a str,
    name: &'a str,
    password: &str,
) -> Result<(&'a str, &'a str), ApiError> {
    let (email, name) = (email.trim(), name.trim());
    if email.is_empty() || name.is_empty() {
        return Err(ApiError::bad_request("email and name are required"));
    }
    password::validate_new(password)?;
    Ok((email, name))
}

/// Public: redeem an invite — create the account and auto-log-in.
pub async fn redeem_invite(
    State(pool): State<PgPool>,
    client: Client,
    Path(token): Path<String>,
    Json(body): Json<dto::RedeemInviteReq>,
) -> Result<Json<dto::LoginResponse>, ApiError> {
    let (email, name) = new_account_fields(&body.email, &body.name, &body.password)?;
    let hash = auth::hash_token_str(&token);
    let pw_hash = password::hash(&body.password)?;
    let user_id = invite_token::redeem_invite(&pool, &hash, email, name, &pw_hash)
        .await
        .map_err(ApiError::conflict_on_unique(
            "an account with this email already exists",
        ))?
        .ok_or(ApiError::NotFound("invalid token"))?;
    let resp = session::issue(&pool, &client, user_id, true).await?;
    tracing::info!(user_id = %user_id, "invite redeemed");
    Ok(Json(resp))
}

/// Public: redeem a reset — set the new password, revoke old sessions, auto-log-in.
pub async fn redeem_reset(
    State(pool): State<PgPool>,
    client: Client,
    Path(token): Path<String>,
    Json(body): Json<dto::RedeemResetReq>,
) -> Result<Json<dto::LoginResponse>, ApiError> {
    password::validate_new(&body.password)?;
    let hash = auth::hash_token_str(&token);
    let pw_hash = password::hash(&body.password)?;
    let (user_id, cleared) = invite_token::redeem_reset(&pool, &hash, &pw_hash)
        .await?
        .ok_or(ApiError::NotFound("invalid token"))?;
    if cleared.any() {
        tracing::info!(user_id = %user_id, reason = "reset", "second factors cleared");
    }
    let resp = session::issue(&pool, &client, user_id, true).await?;
    tracing::info!(user_id = %user_id, "reset link redeemed");
    Ok(Json(resp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::account::{finish_welcome, me};
    use crate::testkit::*;
    use axum::http::StatusCode;
    use sqlx::PgPool;

    async fn invite(pool: &PgPool, admin: Uuid) -> String {
        mint(pool, TokenKind::Invite, None, admin).await.unwrap()
    }

    async fn redeem(
        pool: &PgPool,
        token: &str,
        email: &str,
        password: &str,
    ) -> Result<Json<dto::LoginResponse>, ApiError> {
        redeem_invite(
            State(pool.clone()),
            local(),
            Path(token.to_string()),
            Json(dto::RedeemInviteReq {
                email: email.into(),
                name: "New".into(),
                password: password.into(),
            }),
        )
        .await
    }

    async fn still_valid(pool: &PgPool, token: &str) -> bool {
        invite_token::find_valid(pool, &auth::hash_token_str(token))
            .await
            .unwrap()
            .is_some()
    }

    #[gripsou_core::testkit::db_test]
    async fn redeem_invite_endpoint_creates_account(pool: PgPool) {
        let admin = seed_admin(&pool, "a@t.local").await;
        let raw = invite(&pool, admin).await;

        let resp = redeem(&pool, &raw, "new@t.local", "hunter2-long")
            .await
            .expect("redeem ok");
        assert!(!resp.0.token.is_empty());
        assert_eq!(resp.0.user.email, "new@t.local");
        assert_eq!(resp.0.user.role, Role::User);
        // Token consumed.
        assert!(!still_valid(&pool, &raw).await);
    }

    #[gripsou_core::testkit::db_test]
    async fn redeemed_account_needs_welcome_until_finished(pool: PgPool) {
        let admin = seed_admin(&pool, "a@t.local").await;
        let raw = invite(&pool, admin).await;
        let resp = redeem(&pool, &raw, "new@t.local", "hunter2-long")
            .await
            .expect("redeem ok");
        assert!(!resp.0.user.welcome_done);

        let session = gripsou_core::repo::session::find_valid_by_hash(
            &pool,
            &auth::hash_token(&resp.0.token),
        )
        .await
        .unwrap()
        .unwrap();
        let principal = || auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };
        let status = finish_welcome(State(pool.clone()), principal())
            .await
            .expect("finish ok");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let me_resp = me(State(pool.clone()), principal()).await.expect("me ok");
        assert!(me_resp.0.welcome_done);
    }

    #[gripsou_core::testkit::db_test]
    async fn redeem_invite_endpoint_conflicts_on_existing_email(pool: PgPool) {
        let admin = seed_admin(&pool, "a@t.local").await; // creates a@t.local
        let raw = invite(&pool, admin).await;

        let err = redeem(&pool, &raw, "a@t.local", "hunter2-long")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::CONFLICT);
        // Token left unconsumed.
        assert!(still_valid(&pool, &raw).await);
    }

    #[gripsou_core::testkit::db_test]
    async fn token_info_404_for_unknown(pool: PgPool) {
        let err = token_info(State(pool.clone()), Path("does-not-exist".to_string()))
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
    }

    /// A reset link for `email`, issued by a fresh admin whose unique address
    /// can't collide with a test's own users.
    async fn mint_reset(pool: &PgPool, email: &str) -> String {
        let issuer = format!("issuer-{}@t.local", Uuid::new_v4());
        let admin = seed_user_with_password(pool, &issuer, PASSWORD, Role::Admin).await;
        mint(pool, TokenKind::Reset, Some(email), admin)
            .await
            .unwrap()
    }

    async fn call_redeem_reset(
        pool: &PgPool,
        raw: &str,
        password: &str,
    ) -> Result<Json<dto::LoginResponse>, ApiError> {
        redeem_reset(
            State(pool.clone()),
            local(),
            Path(raw.to_string()),
            Json(dto::RedeemResetReq {
                password: password.into(),
            }),
        )
        .await
    }

    /// A valid reset link sets the new password, kills the old one, signs out
    /// every old session and logs the user in.
    #[gripsou_core::testkit::db_test]
    async fn redeem_reset_sets_password_and_revokes_sessions(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", Role::User).await;
        let old_session = principal_for(&pool, "t@t.local", "old-pw").await;
        let raw = mint_reset(&pool, "t@t.local").await;

        let resp = call_redeem_reset(&pool, &raw, "new-password")
            .await
            .expect("redeem ok")
            .0;
        assert_eq!(resp.user.email, "t@t.local");
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&resp.token))
                .await
                .unwrap()
                .is_some(),
            "the response logs the user in"
        );
        assert!(can_login(&pool, "t@t.local", "new-password").await);
        assert!(!can_login(&pool, "t@t.local", "old-pw").await);
        assert!(!session_alive(&pool, old_session.session_id).await);
    }

    /// A reset link works once: replaying it is a 404 and cannot overwrite the
    /// password chosen with it.
    #[gripsou_core::testkit::db_test]
    async fn redeem_reset_token_is_single_use(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", Role::User).await;
        let raw = mint_reset(&pool, "t@t.local").await;
        assert!(
            call_redeem_reset(&pool, &raw, "first-pw").await.is_ok(),
            "first redeem ok"
        );

        let err = call_redeem_reset(&pool, &raw, "second-pw")
            .await
            .expect_err("replay must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert!(can_login(&pool, "t@t.local", "first-pw").await);
        assert!(!can_login(&pool, "t@t.local", "second-pw").await);
    }

    /// An unknown reset token is a 404 and changes no password.
    #[gripsou_core::testkit::db_test]
    async fn redeem_reset_unknown_token_is_404(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", Role::User).await;
        let err = call_redeem_reset(&pool, "never-minted", "new-password")
            .await
            .expect_err("unknown token must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert!(can_login(&pool, "t@t.local", "old-pw").await);
    }

    /// An expired reset link is a 404 and changes no password.
    #[gripsou_core::testkit::db_test]
    async fn redeem_reset_expired_token_is_404(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", Role::User).await;
        let raw = mint_reset(&pool, "t@t.local").await;
        gripsou_core::testkit::expire(
            &pool,
            "invite_token",
            "token = $1",
            auth::hash_token_str(&raw),
        )
        .await;

        let err = call_redeem_reset(&pool, &raw, "new-password")
            .await
            .expect_err("expired token must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert!(can_login(&pool, "t@t.local", "old-pw").await);
    }

    #[gripsou_core::testkit::db_test]
    async fn reset_refuses_a_short_password(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-password", Role::User).await;
        let raw = mint_reset(&pool, "t@t.local").await;
        let err = call_redeem_reset(&pool, &raw, "1234567").await.unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        // The link was not spent: a valid password still works with it.
        assert!(call_redeem_reset(&pool, &raw, "12345678").await.is_ok());
    }

    #[gripsou_core::testkit::db_test]
    async fn invite_refuses_a_short_password(pool: PgPool) {
        let admin = seed_admin(&pool, "a@t.local").await;
        let raw = invite(&pool, admin).await;
        let err = redeem(&pool, &raw, "new@t.local", "1234567")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    /// An empty new password is a 400 and does not burn the link, so the user
    /// can retry with a real one.
    #[gripsou_core::testkit::db_test]
    async fn redeem_reset_rejects_empty_password(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", Role::User).await;
        let raw = mint_reset(&pool, "t@t.local").await;

        let err = call_redeem_reset(&pool, &raw, "")
            .await
            .expect_err("empty password must fail");
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert!(can_login(&pool, "t@t.local", "old-pw").await);
        assert!(still_valid(&pool, &raw).await);
    }
}
