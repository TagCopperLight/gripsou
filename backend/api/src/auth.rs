//! Authentication primitives: argon2 password hashing, opaque session token
//! generation/hashing, User-Agent parsing, and the `AuthUser` request extractor.
//! Sessions are DB-backed: the raw token is never stored, only its SHA-256 hash.

use argon2::password_hash::{SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::FromRef;
use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::ApiError;

/// Only re-touch a session at most this often, so we don't write on every request.
pub const TOUCH_THROTTLE_SECS: i64 = 5 * 60;

/// A fresh opaque session token: 256 bits of OS randomness, base64url-encoded.
/// Returned to the client once; only its hash is ever stored.
pub fn generate_token() -> String {
    use argon2::password_hash::rand_core::RngCore;
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// SHA-256 of the raw token — what we persist and look up by.
pub fn hash_token(token: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher.finalize().to_vec()
}

/// SHA-256 of the token, base64url-encoded — for the `invite_token.token` text
/// column (the bytea-friendly `hash_token` is for sessions).
pub fn hash_token_str(token: &str) -> String {
    URL_SAFE_NO_PAD.encode(hash_token(token))
}

/// Best-effort friendly device label. A self-hosted app needs only a small
/// heuristic; unknown parts degrade to "Unknown …". Order matters: Edge/Opera
/// UAs also contain "Chrome", and Chrome UAs also contain "Safari".
pub fn parse_user_agent(ua: &str) -> String {
    let browser = if ua.contains("Edg/") {
        "Edge"
    } else if ua.contains("OPR/") || ua.contains("Opera") {
        "Opera"
    } else if ua.contains("Firefox/") {
        "Firefox"
    } else if ua.contains("Chrome/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else {
        "Unknown browser"
    };
    let os = if ua.contains("Windows") {
        "Windows"
    } else if ua.contains("iPhone") || ua.contains("iPad") {
        // Their UAs also say "Mac OS X".
        "iOS"
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        "macOS"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("Linux") {
        "Linux"
    } else {
        "Unknown OS"
    };
    format!("{browser} on {os}")
}

pub fn hash_password(plain: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default().hash_password(plain.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

pub fn verify_password(plain: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(plain.as_bytes(), &parsed)
            .is_ok(),
        Err(e) => {
            // Same answer as a wrong password for the caller; the operator
            // needs to know the stored hash is unreadable.
            tracing::error!(error = %gripsou_core::logs::error_chain(&e), "stored password hash unreadable");
            false
        }
    }
}

/// Hash checked when the email matches no account, so a login answers in the
/// same time whether or not the email exists. Computed once, on first use.
pub static DUMMY_HASH: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    hash_password("gripsou-dummy-password").expect("hashing a constant cannot fail")
});

/// `verify_password`, or the same amount of work against `DUMMY_HASH` when
/// there is no account (`hash` is `None`), which never succeeds.
pub fn verify_password_or_dummy(plain: &str, hash: Option<&str>) -> bool {
    match hash {
        Some(h) => verify_password(plain, h),
        None => {
            let _ = verify_password(plain, &DUMMY_HASH);
            false
        }
    }
}

pub const PASSWORD_MIN_CHARS: usize = 8;
pub const PASSWORD_MAX_CHARS: usize = 128;

/// The one rule for a password being set (invite, reset, change): length
/// only, counted in characters. Existing shorter passwords keep working.
pub fn validate_new_password(pw: &str) -> Result<(), ApiError> {
    if (PASSWORD_MIN_CHARS..=PASSWORD_MAX_CHARS).contains(&pw.chars().count()) {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            "password must be 8 to 128 characters",
        ))
    }
}

/// The authenticated principal, resolved from the opaque bearer token by DB
/// lookup. Carries the session id so handlers can mark/skip the current session.
#[derive(Debug)]
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
        let hash = hash_token(token);
        let session = gripsou_core::repo::session::find_valid_by_hash(&pool, &hash)
            .await?
            .ok_or_else(unauthorized)?;
        tracing::Span::current().record("user_id", tracing::field::display(session.user_id));

        // Throttled sliding-window bump; failures here must not fail the request.
        if (Utc::now() - session.last_active_at).num_seconds() >= TOUCH_THROTTLE_SECS
            && let Err(e) =
                gripsou_core::repo::session::touch(&pool, session.id, session.remembered).await
        {
            tracing::warn!(error = %gripsou_core::logs::error_chain(&e), "session touch failed");
        }

        Ok(AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        })
    }
}

/// An [`AuthUser`] whose role is admin, else 403. Server config, providers
/// and user management are admin-only: `app_settings` is the admin-tunable
/// config.
#[derive(Debug)]
pub struct AdminUser {
    pub user_id: Uuid,
}

impl<S> FromRequestParts<S> for AdminUser
where
    S: Send + Sync,
    sqlx::PgPool: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let AuthUser { user_id, .. } = AuthUser::from_request_parts(parts, state).await?;
        let pool = sqlx::PgPool::from_ref(state);
        let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
            .await?
            .ok_or(ApiError::Unauthorized)?;
        if profile.role != "admin" {
            return Err(ApiError::Forbidden("admin access required"));
        }
        Ok(AdminUser { user_id })
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    #[test]
    fn dummy_hash_is_a_real_argon2_hash() {
        // A malformed dummy would fail fast and bring the timing gap back.
        assert!(PasswordHash::new(&DUMMY_HASH).is_ok());
    }

    #[test]
    fn verify_or_dummy_never_accepts_a_missing_user() {
        assert!(!verify_password_or_dummy("gripsou-dummy-password", None));
        assert!(!verify_password_or_dummy("", None));
    }

    #[test]
    fn verify_or_dummy_checks_a_real_hash() {
        let hash = hash_password("hunter22").unwrap();
        assert!(verify_password_or_dummy("hunter22", Some(&hash)));
        assert!(!verify_password_or_dummy("wrong", Some(&hash)));
    }

    #[test]
    fn new_password_length_bounds() {
        assert!(validate_new_password(&"a".repeat(7)).is_err());
        assert!(validate_new_password(&"a".repeat(8)).is_ok());
        assert!(validate_new_password(&"a".repeat(128)).is_ok());
        assert!(validate_new_password(&"a".repeat(129)).is_err());
        assert!(validate_new_password("").is_err());
        // Counted in characters, not bytes: 8 accented letters are 16 bytes.
        assert!(validate_new_password("éééééééé").is_ok());
        let err = validate_new_password("short").unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert_eq!(err.message(), "password must be 8 to 128 characters");
    }

    use super::*;
    use axum::http::{Request, header::AUTHORIZATION};
    use chrono::Duration;
    use sqlx::PgPool;

    use gripsou_core::testkit::seed_user;

    /// Build request parts from a request, optionally with a Bearer token header.
    fn make_parts(bearer: Option<&str>) -> axum::http::request::Parts {
        let mut builder = Request::builder();
        if let Some(token) = bearer {
            builder = builder.header(AUTHORIZATION, format!("Bearer {token}"));
        }
        let (parts, _body) = builder.body(()).unwrap().into_parts();
        parts
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn extractor_accepts_valid_token(pool: PgPool) {
        let user_id = seed_user(&pool).await;
        let raw = generate_token();
        let hash = hash_token(&raw);
        let session = gripsou_core::repo::session::create(
            &pool,
            user_id,
            &hash,
            None,
            None,
            false,
            Utc::now() + Duration::days(1),
        )
        .await
        .unwrap();

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
        let raw = generate_token();
        let hash = hash_token(&raw);
        // Create a session already expired (in the past)
        gripsou_core::repo::session::create(
            &pool,
            user_id,
            &hash,
            None,
            None,
            false,
            Utc::now() - Duration::hours(1),
        )
        .await
        .unwrap();

        let mut parts = make_parts(Some(&raw));
        let err = AuthUser::from_request_parts(&mut parts, &pool)
            .await
            .expect_err("should fail for expired session");
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn generated_tokens_are_unique_and_hash_stably() {
        let a = generate_token();
        let b = generate_token();
        assert_ne!(a, b);
        assert!(a.len() >= 40);
        assert_eq!(hash_token(&a), hash_token(&a));
        assert_eq!(hash_token(&a).len(), 32);
        assert_ne!(hash_token(&a), hash_token(&b));
    }

    #[test]
    fn parses_common_user_agents() {
        let chrome_mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
            (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
        assert_eq!(parse_user_agent(chrome_mac), "Chrome on macOS");

        let ff_linux = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
        assert_eq!(parse_user_agent(ff_linux), "Firefox on Linux");

        let edge_win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
            (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
        assert_eq!(parse_user_agent(edge_win), "Edge on Windows");

        let iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
        assert_eq!(parse_user_agent(iphone), "Safari on iOS");
        let ipad = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
        assert_eq!(parse_user_agent(ipad), "Safari on iOS");
        assert_eq!(parse_user_agent("weird"), "Unknown browser on Unknown OS");
    }

    #[test]
    fn hash_then_verify_roundtrips() {
        let hash = hash_password("hunter2").unwrap();
        assert!(verify_password("hunter2", &hash));
        assert!(!verify_password("wrong", &hash));
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

    #[test]
    fn a_corrupt_stored_hash_is_not_a_match() {
        assert!(!verify_password("pw", "not-a-phc-string"));
    }
}
