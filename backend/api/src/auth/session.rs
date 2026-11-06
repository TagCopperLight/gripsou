//! Sessions: issuing one at sign-in, and resolving the bearer token of every
//! authenticated request into [`AuthUser`].

use axum::extract::{FromRef, FromRequestParts, Request, State};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::Response;
use chrono::Utc;
use uuid::Uuid;

use crate::auth::dto;
use crate::auth::{self, client::Client};
use crate::error::ApiError;
use gripsou_core::repo::session;
use gripsou_core::repo::user::Role;

/// Re-touch a session at most this often, so a request doesn't always write.
const TOUCH_THROTTLE_SECS: i64 = 5 * 60;

/// Issue a session for `user_id` and build the login-shaped response. Logs
/// nothing: each sign-in words its own line.
pub async fn issue(
    pool: &sqlx::PgPool,
    client: &Client,
    user_id: Uuid,
    remember: bool,
) -> Result<dto::LoginResponse, ApiError> {
    let profile = gripsou_core::repo::user::profile_by_id(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::internal("user vanished"))?;
    let token = auth::generate_token();
    session::create(
        pool,
        user_id,
        &auth::hash_token(&token),
        client.browser(),
        Some(client.ip.as_str()),
        remember,
    )
    .await?;
    Ok(dto::LoginResponse {
        token,
        user: dto::SessionUser::from_profile(&profile),
    })
}

/// The authenticated principal, resolved from the opaque bearer token by DB
/// lookup. Carries the session id so handlers can mark/skip the current session.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub session_id: Uuid,
}

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    sqlx::PgPool: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let unauthorized = || ApiError::Unauthorized;
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(unauthorized)?;

        let pool = sqlx::PgPool::from_ref(state);
        let found = session::find_valid_by_hash(&pool, &auth::hash_token(token))
            .await?
            .ok_or_else(unauthorized)?;
        tracing::Span::current().record("user_id", tracing::field::display(found.user_id));

        // Failures here must not fail the request.
        if (Utc::now() - found.last_active_at).num_seconds() >= TOUCH_THROTTLE_SECS
            && let Err(e) = session::touch(&pool, found.id, found.remembered).await
        {
            tracing::warn!(error = %gripsou_core::logs::error_chain(&e), "session touch failed");
        }

        Ok(AuthUser {
            user_id: found.user_id,
            session_id: found.id,
        })
    }
}

/// The admin making the request. Only [`require_admin`] creates one, so a
/// handler can only get it behind the admin check.
#[derive(Debug, Clone)]
pub struct AdminUser {
    pub user_id: Uuid,
}

impl<S: Send + Sync> FromRequestParts<S> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AdminUser>()
            .cloned()
            .ok_or_else(|| ApiError::internal("admin handler outside the admin routes"))
    }
}

/// Lets a request through only from an admin, else 403. Server config,
/// providers and user management are admin-only: `app_settings` is the
/// admin-tunable config.
pub async fn require_admin(
    State(pool): State<sqlx::PgPool>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let (mut parts, body) = request.into_parts();
    let AuthUser { user_id, .. } = AuthUser::from_request_parts(&mut parts, &pool).await?;
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    if profile.role != Role::Admin {
        return Err(ApiError::Forbidden("admin access required"));
    }
    parts.extensions.insert(AdminUser { user_id });
    Ok(next.run(Request::from_parts(parts, body)).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{Request, StatusCode};
    use sqlx::PgPool;

    use gripsou_core::testkit::seed_user;

    /// Build request parts, optionally with a Bearer token header.
    fn make_parts(bearer: Option<&str>) -> Parts {
        let mut builder = Request::builder();
        if let Some(token) = bearer {
            builder = builder.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        let (parts, _body) = builder.body(()).unwrap().into_parts();
        parts
    }

    async fn seed_session(pool: &PgPool, user_id: Uuid) -> (String, session::Session) {
        let raw = auth::generate_token();
        let s = session::create(pool, user_id, &auth::hash_token(&raw), None, None, false)
            .await
            .unwrap();
        (raw, s)
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn extractor_accepts_valid_token(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let (raw, session) = seed_session(&pool, user_id).await;

        let mut parts = make_parts(Some(&raw));
        let auth_user = AuthUser::from_request_parts(&mut parts, &pool)
            .await
            .expect("should succeed for a valid token");

        assert_eq!(auth_user.user_id, user_id);
        assert_eq!(auth_user.session_id, session.id);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn extractor_rejects_missing_header(pool: PgPool) {
        let mut parts = make_parts(None);
        let err = AuthUser::from_request_parts(&mut parts, &pool)
            .await
            .expect_err("should fail with no Authorization header");
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn extractor_rejects_garbage_token(pool: PgPool) {
        let mut parts = make_parts(Some("not-a-real-token-xyzzy"));
        let err = AuthUser::from_request_parts(&mut parts, &pool)
            .await
            .expect_err("should fail for unknown token");
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn extractor_rejects_expired_token(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let (raw, session) = seed_session(&pool, user_id).await;
        gripsou_core::testkit::expire(&pool, "session", "id = $1", session.id).await;

        let mut parts = make_parts(Some(&raw));
        let err = AuthUser::from_request_parts(&mut parts, &pool)
            .await
            .expect_err("should fail for expired session");
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    /// A database outage is a server error, not "you are logged out": a 401
    /// would make the SPA drop the session.
    #[sqlx::test(migrations = "../migrations")]
    async fn session_lookup_failure_is_a_server_error(pool: PgPool) {
        pool.close().await;
        let mut parts = make_parts(Some("whatever"));
        let err = AuthUser::from_request_parts(&mut parts, &pool)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
