//! Authentication primitives: argon2 password hashing, opaque session token
//! generation/hashing, User-Agent parsing, and the `AuthUser` request extractor.
//! Sessions are DB-backed: the raw token is never stored, only its SHA-256 hash.

use argon2::password_hash::{SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::FromRef;
use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

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
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        "macOS"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("iPhone") || ua.contains("iPad") {
        "iOS"
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
        Err(_) => false,
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
    type Rejection = (StatusCode, String);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let unauthorized = || (StatusCode::UNAUTHORIZED, "unauthorized".to_string());
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(unauthorized)?;

        let pool = sqlx::PgPool::from_ref(state);
        let hash = hash_token(token);
        let session = gripsou_core::repo::session::find_valid_by_hash(&pool, &hash)
            .await
            .map_err(|e| {
                tracing::warn!("session lookup failed: {e}");
                unauthorized()
            })?
            .ok_or_else(unauthorized)?;

        // Throttled sliding-window bump; failures here must not fail the request.
        if (Utc::now() - session.last_active_at).num_seconds() >= TOUCH_THROTTLE_SECS {
            let _ = gripsou_core::repo::session::touch(&pool, session.id, session.remembered).await;
        }

        Ok(AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{Request, header::AUTHORIZATION};
    use chrono::Duration;
    use sqlx::PgPool;
    use uuid::Uuid;

    async fn seed_user(pool: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, 'extractor@t.local', 'Test', 'h', 'user')",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
        id
    }

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
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn extractor_rejects_garbage_token(pool: PgPool) {
        let mut parts = make_parts(Some("not-a-real-token-xyzzy"));
        let err = AuthUser::from_request_parts(&mut parts, &pool)
            .await
            .expect_err("should fail for unknown token");
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
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
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
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

        assert_eq!(parse_user_agent("weird"), "Unknown browser on Unknown OS");
    }

    #[test]
    fn hash_then_verify_roundtrips() {
        let hash = hash_password("hunter2").unwrap();
        assert!(verify_password("hunter2", &hash));
        assert!(!verify_password("wrong", &hash));
    }

    #[test]
    fn verify_rejects_garbage_hash() {
        assert!(!verify_password("anything", "not-a-phc-hash"));
    }
}
