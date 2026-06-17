//! Authentication primitives: argon2 password hashing, HS256 JWT issue/verify,
//! and the `AuthUser` request extractor. The signing secret is process-global
//! (`init_secret` in `main`); token functions take it explicitly so they stay
//! unit-testable without touching global state.

use std::sync::OnceLock;

use argon2::password_hash::{SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Token lifetime. Short-lived: the client holds it in memory and re-logs-in on
/// refresh, so this only bounds a single session.
pub const TOKEN_TTL_SECS: i64 = 24 * 3600;

static SECRET: OnceLock<String> = OnceLock::new();

/// Set the HS256 signing secret once at startup. Idempotent (later calls are
/// ignored), which keeps test setup simple.
pub fn init_secret(secret: String) {
    let _ = SECRET.set(secret);
}

/// The process-global signing secret. Panics if `init_secret` hasn't run —
/// `main` calls it at startup; tests call it before issuing tokens.
pub fn secret() -> &'static str {
    SECRET
        .get()
        .expect("auth::init_secret must be called before issuing/verifying tokens")
        .as_str()
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

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: i64,
}

pub fn issue_token(
    user_id: Uuid,
    secret: &str,
    ttl_secs: i64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let claims = Claims {
        sub: user_id.to_string(),
        exp: chrono::Utc::now().timestamp() + ttl_secs,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn verify_token(token: &str, secret: &str) -> Result<Uuid, ()> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ())?;
    Uuid::parse_str(&data.claims.sub).map_err(|_| ())
}

/// Extractor that resolves the authenticated user id from a
/// `Authorization: Bearer <jwt>` header. Missing or invalid → 401.
#[derive(Debug)]
pub struct AuthUser(pub Uuid);

impl<S: Send + Sync> FromRequestParts<S> for AuthUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let unauthorized = || (StatusCode::UNAUTHORIZED, "unauthorized".to_string());
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(unauthorized)?;
        let user_id = verify_token(token, secret()).map_err(|_| unauthorized())?;
        Ok(AuthUser(user_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SECRET: &str = "test-signing-secret";

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

    #[test]
    fn token_roundtrips() {
        let id = Uuid::new_v4();
        let token = issue_token(id, TEST_SECRET, TOKEN_TTL_SECS).unwrap();
        assert_eq!(verify_token(&token, TEST_SECRET).unwrap(), id);
    }

    #[test]
    fn token_rejected_with_wrong_secret() {
        let token = issue_token(Uuid::new_v4(), TEST_SECRET, TOKEN_TTL_SECS).unwrap();
        assert!(verify_token(&token, "other-secret").is_err());
    }

    #[test]
    fn expired_token_is_rejected() {
        // Beyond jsonwebtoken's default 60s exp leeway (clock-skew tolerance).
        let token = issue_token(Uuid::new_v4(), TEST_SECRET, -3600).unwrap();
        assert!(verify_token(&token, TEST_SECRET).is_err());
    }

    #[tokio::test]
    async fn extractor_accepts_valid_bearer_and_rejects_missing() {
        init_secret(TEST_SECRET.to_string());
        let id = Uuid::new_v4();
        let token = issue_token(id, secret(), TOKEN_TTL_SECS).unwrap();

        let req = axum::http::Request::builder()
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(())
            .unwrap();
        let (mut parts, _) = req.into_parts();
        let got = AuthUser::from_request_parts(&mut parts, &()).await.unwrap();
        assert_eq!(got.0, id);

        let bare = axum::http::Request::builder().body(()).unwrap();
        let (mut parts, _) = bare.into_parts();
        let err = AuthUser::from_request_parts(&mut parts, &())
            .await
            .unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
    }
}
