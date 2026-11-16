use argon2::password_hash::{SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use uuid::Uuid;

use crate::auth::client::Client;
use crate::auth::throttle::{Account, Throttles};
use crate::error::ApiError;

pub const MIN_CHARS: usize = 8;
pub const MAX_CHARS: usize = 128;

/// No real address is longer (RFC 5321).
pub const MAX_EMAIL_LEN: usize = 254;

pub fn hash(plain: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default().hash_password(plain.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

pub fn verify(plain: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(plain.as_bytes(), &parsed)
            .is_ok(),
        Err(e) => {
            // Answers like a wrong password; the operator needs to know the stored hash is unreadable.
            tracing::error!(error = %gripsou_core::logs::error_chain(&e), "stored password hash unreadable");
            false
        }
    }
}

/// Checked when the email matches no account, so a login takes the same time either way.
pub static DUMMY_HASH: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    hash("gripsou-dummy-password").expect("hashing a constant cannot fail")
});

pub fn verify_or_dummy(plain: &str, hash: Option<&str>) -> bool {
    match hash {
        Some(h) => verify(plain, h),
        None => {
            let _ = verify(plain, &DUMMY_HASH);
            false
        }
    }
}

/// Length only, counted in characters. Existing shorter passwords keep working.
pub fn validate_new(pw: &str) -> Result<(), ApiError> {
    if (MIN_CHARS..=MAX_CHARS).contains(&pw.chars().count()) {
        Ok(())
    } else {
        Err(ApiError::bad_request(format!(
            "password must be {MIN_CHARS} to {MAX_CHARS} characters"
        )))
    }
}

/// Counted on the account's login throttle, so a stolen session guesses no faster than the login form allows.
pub async fn check(
    pool: &sqlx::PgPool,
    throttles: &Throttles,
    client: &Client,
    user_id: Uuid,
    password: &str,
) -> Result<(), ApiError> {
    let attempt = throttles.password(
        Account::User(user_id),
        &client.ip,
        std::time::Instant::now(),
    )?;
    let hash = gripsou_core::repo::user::password_hash(pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    if !verify(password, &hash) {
        tracing::warn!(user_id = %user_id, ip = %client.ip, "password check failed");
        return Err(ApiError::bad_request("password is incorrect"));
    }
    attempt.succeeded();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    #[test]
    fn dummy_hash_is_a_real_argon2_hash() {
        // A malformed dummy would fail fast and bring the timing gap back.
        assert!(PasswordHash::new(&DUMMY_HASH).is_ok());
    }

    #[test]
    fn verify_or_dummy_never_accepts_a_missing_user() {
        assert!(!verify_or_dummy("gripsou-dummy-password", None));
        assert!(!verify_or_dummy("", None));
    }

    #[test]
    fn verify_or_dummy_checks_a_real_hash() {
        let hash = hash("hunter22").unwrap();
        assert!(verify_or_dummy("hunter22", Some(&hash)));
        assert!(!verify_or_dummy("wrong", Some(&hash)));
    }

    #[test]
    fn new_password_length_bounds() {
        assert!(validate_new(&"a".repeat(7)).is_err());
        assert!(validate_new(&"a".repeat(8)).is_ok());
        assert!(validate_new(&"a".repeat(128)).is_ok());
        assert!(validate_new(&"a".repeat(129)).is_err());
        assert!(validate_new("").is_err());
        // Counted in characters, not bytes: 8 accented letters are 16 bytes.
        assert!(validate_new("éééééééé").is_ok());
        let err = validate_new("short").unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert_eq!(err.message(), "password must be 8 to 128 characters");
    }

    #[test]
    fn hash_then_verify_roundtrips() {
        let hash = hash("hunter2").unwrap();
        assert!(verify("hunter2", &hash));
        assert!(!verify("wrong", &hash));
    }

    #[test]
    fn a_corrupt_stored_hash_is_not_a_match() {
        assert!(!verify("pw", "not-a-phc-string"));
    }
}
