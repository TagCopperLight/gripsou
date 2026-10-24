//! Invite and reset links: reading one, and redeeming it for a password.

use axum::Json;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::HeaderMap;
use sqlx::PgPool;
use std::net::SocketAddr;

use crate::auth::login::issue_session;
use crate::auth::{self};
use crate::dto;
use crate::error::ApiError;

/// Public: validate a token on page load so the frontend can redirect away from
/// `/invite` or `/reset` when it's invalid. 404 = unknown/expired/used.
pub async fn token_info(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> Result<Json<dto::TokenInfoResp>, ApiError> {
    let hash = auth::hash_token_str(&token);
    let info = gripsou_core::repo::invite_token::find_valid(&pool, &hash)
        .await?
        .ok_or(ApiError::NotFound("invalid token"))?;
    Ok(Json(dto::TokenInfoResp {
        token_type: info.token_type,
        email: info.email,
    }))
}

/// Public: redeem an invite — create the account and auto-log-in.
pub async fn redeem_invite(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    Json(body): Json<dto::RedeemInviteReq>,
) -> Result<Json<dto::LoginResponse>, ApiError> {
    let email = body.email.trim();
    let name = body.name.trim();
    if email.is_empty() || name.is_empty() {
        return Err(ApiError::bad_request("email and name are required"));
    }
    auth::validate_new_password(&body.password)?;
    let hash = auth::hash_token_str(&token);
    let pw_hash = auth::hash_password(&body.password)?;
    let user_id =
        gripsou_core::repo::invite_token::redeem_invite(&pool, &hash, email, name, &pw_hash)
            .await
            .map_err(ApiError::conflict_on_unique(
                "an account with this email already exists",
            ))?
            .ok_or(ApiError::NotFound("invalid token"))?;
    let resp = issue_session(&pool, &headers, peer, user_id, true).await?;
    tracing::info!(user_id = %user_id, "invite redeemed");
    Ok(Json(resp))
}

/// Public: redeem a reset — set the new password, revoke old sessions, auto-log-in.
pub async fn redeem_reset(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(token): Path<String>,
    Json(body): Json<dto::RedeemResetReq>,
) -> Result<Json<dto::LoginResponse>, ApiError> {
    auth::validate_new_password(&body.password)?;
    let hash = auth::hash_token_str(&token);
    let pw_hash = auth::hash_password(&body.password)?;
    let (user_id, cleared) = gripsou_core::repo::invite_token::redeem_reset(&pool, &hash, &pw_hash)
        .await?
        .ok_or(ApiError::NotFound("invalid token"))?;
    if cleared.any() {
        tracing::info!(user_id = %user_id, reason = "reset", "second factors cleared");
    }
    let resp = issue_session(&pool, &headers, peer, user_id, true).await?;
    tracing::info!(user_id = %user_id, "reset link redeemed");
    Ok(Json(resp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth;
    use crate::auth::account::{finish_welcome, me};
    use crate::testkit::*;
    use axum::http::StatusCode;
    use chrono::{Duration, Utc};
    use sqlx::PgPool;
    use uuid::Uuid;

    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_invite_endpoint_creates_account(pool: PgPool) {
        let admin = seed_admin_user(&pool).await;
        gripsou_core::repo::invite_token::create(
            &pool,
            "invite",
            None,
            admin,
            &auth::hash_token_str("raw-invite"),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();

        let resp = redeem_invite(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path("raw-invite".to_string()),
            Json(dto::RedeemInviteReq {
                email: "new@t.local".into(),
                name: "New".into(),
                password: "hunter2-long".into(),
            }),
        )
        .await
        .expect("redeem ok");
        assert!(!resp.0.token.is_empty());
        assert_eq!(resp.0.user.email, "new@t.local");
        assert_eq!(resp.0.user.role, "user");
        // Token consumed.
        assert!(
            gripsou_core::repo::invite_token::find_valid(
                &pool,
                &auth::hash_token_str("raw-invite")
            )
            .await
            .unwrap()
            .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn redeemed_account_needs_welcome_until_finished(pool: PgPool) {
        let admin = seed_admin_user(&pool).await;
        gripsou_core::repo::invite_token::create(
            &pool,
            "invite",
            None,
            admin,
            &auth::hash_token_str("raw-invite"),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();
        let resp = redeem_invite(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path("raw-invite".to_string()),
            Json(dto::RedeemInviteReq {
                email: "new@t.local".into(),
                name: "New".into(),
                password: "hunter2-long".into(),
            }),
        )
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

    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_invite_endpoint_conflicts_on_existing_email(pool: PgPool) {
        let admin = seed_admin_user(&pool).await; // creates a@t.local
        gripsou_core::repo::invite_token::create(
            &pool,
            "invite",
            None,
            admin,
            &auth::hash_token_str("raw-invite"),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();

        let err = redeem_invite(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path("raw-invite".to_string()),
            Json(dto::RedeemInviteReq {
                email: "a@t.local".into(),
                name: "Dup".into(),
                password: "hunter2-long".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::CONFLICT);
        // Token left unconsumed.
        assert!(
            gripsou_core::repo::invite_token::find_valid(
                &pool,
                &auth::hash_token_str("raw-invite")
            )
            .await
            .unwrap()
            .is_some()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn token_info_404_for_unknown(pool: PgPool) {
        let err = token_info(State(pool.clone()), Path("does-not-exist".to_string()))
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
    }

    /// Store a reset link for `email`, issued by a fresh admin whose unique
    /// address can't collide with a test's own users.
    async fn mint_reset(pool: &PgPool, raw: &str, email: &str, expires_in: Duration) {
        let issuer = format!("issuer-{}@t.local", Uuid::new_v4());
        let admin = seed_user_with_password(pool, &issuer, "pw", "admin").await;
        gripsou_core::repo::invite_token::create(
            pool,
            "reset",
            Some(email),
            admin,
            &auth::hash_token_str(raw),
            Utc::now() + expires_in,
        )
        .await
        .unwrap();
    }

    async fn call_redeem_reset(
        pool: &PgPool,
        raw: &str,
        password: &str,
    ) -> Result<Json<dto::LoginResponse>, ApiError> {
        redeem_reset(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path(raw.to_string()),
            Json(dto::RedeemResetReq {
                password: password.into(),
            }),
        )
        .await
    }

    /// A valid reset link sets the new password, kills the old one, signs out
    /// every old session and logs the user in.
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_sets_password_and_revokes_sessions(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        let old_session = principal_for(&pool, "t@t.local", "old-pw").await;
        mint_reset(&pool, "raw-reset", "t@t.local", Duration::hours(1)).await;

        let resp = call_redeem_reset(&pool, "raw-reset", "new-password")
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
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_token_is_single_use(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        mint_reset(&pool, "raw-reset", "t@t.local", Duration::hours(1)).await;
        assert!(
            call_redeem_reset(&pool, "raw-reset", "first-pw")
                .await
                .is_ok(),
            "first redeem ok"
        );

        let err = call_redeem_reset(&pool, "raw-reset", "second-pw")
            .await
            .expect_err("replay must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert!(can_login(&pool, "t@t.local", "first-pw").await);
        assert!(!can_login(&pool, "t@t.local", "second-pw").await);
    }

    /// An unknown reset token is a 404 and changes no password.
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_unknown_token_is_404(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        let err = call_redeem_reset(&pool, "never-minted", "new-password")
            .await
            .expect_err("unknown token must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert!(can_login(&pool, "t@t.local", "old-pw").await);
    }

    /// An expired reset link is a 404 and changes no password.
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_expired_token_is_404(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        mint_reset(&pool, "raw-reset", "t@t.local", Duration::hours(-1)).await;

        let err = call_redeem_reset(&pool, "raw-reset", "new-password")
            .await
            .expect_err("expired token must fail");
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert!(can_login(&pool, "t@t.local", "old-pw").await);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn reset_refuses_a_short_password(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-password", "user").await;
        mint_reset(&pool, "raw-short", "t@t.local", Duration::hours(1)).await;
        let err = call_redeem_reset(&pool, "raw-short", "1234567")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        // The link was not spent: a valid password still works with it.
        assert!(
            call_redeem_reset(&pool, "raw-short", "12345678")
                .await
                .is_ok()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn invite_refuses_a_short_password(pool: PgPool) {
        let admin = seed_admin_user(&pool).await;
        gripsou_core::repo::invite_token::create(
            &pool,
            "invite",
            None,
            admin,
            &auth::hash_token_str("raw-invite"),
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();
        let err = redeem_invite(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Path("raw-invite".to_string()),
            Json(dto::RedeemInviteReq {
                email: "new@t.local".into(),
                name: "New".into(),
                password: "1234567".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    /// An empty new password is a 400 and does not burn the link, so the user
    /// can retry with a real one.
    #[sqlx::test(migrations = "../migrations")]
    async fn redeem_reset_rejects_empty_password(pool: PgPool) {
        seed_user_with_password(&pool, "t@t.local", "old-pw", "user").await;
        mint_reset(&pool, "raw-reset", "t@t.local", Duration::hours(1)).await;

        let err = call_redeem_reset(&pool, "raw-reset", "")
            .await
            .expect_err("empty password must fail");
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert!(can_login(&pool, "t@t.local", "old-pw").await);
        assert!(
            gripsou_core::repo::invite_token::find_valid(&pool, &auth::hash_token_str("raw-reset"))
                .await
                .unwrap()
                .is_some()
        );
    }
}
