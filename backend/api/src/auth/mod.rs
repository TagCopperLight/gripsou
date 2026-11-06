//! Authentication. Opaque tokens (sessions, challenges, invite and reset
//! links) are random strings handed to the client once: only their SHA-256
//! hash is stored.

pub mod account;
pub mod challenge;
pub mod client;
pub mod dto;
pub mod factors;
pub mod invite;
pub mod login;
pub mod mfa;
pub mod passkey;
pub mod password;
pub mod session;
pub mod throttle;

pub use session::{AdminUser, AuthUser};

use axum::Router;
use axum::routing::{delete, get, patch, post};

use crate::AppState;

use argon2::password_hash::rand_core::{OsRng, RngCore};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

/// 256 bits of OS randomness, base64url-encoded.
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// SHA-256 of the raw token: what sessions and challenges store.
pub fn hash_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// [`hash_token`], base64url-encoded, for the `invite_token.token` text column.
pub fn hash_token_str(token: &str) -> String {
    URL_SAFE_NO_PAD.encode(hash_token(token))
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(login::login))
        .route("/auth/login/verify", post(login::login_verify))
        .route("/auth/passkey/options", post(passkey::sign_in_options))
        .route("/auth/passkey", post(passkey::sign_in))
        .route("/auth/reauth", post(mfa::reauth))
        .route("/auth/mfa/status", get(mfa::status))
        .route("/auth/mfa/totp/setup", post(mfa::totp_setup))
        .route("/auth/mfa/totp/confirm", post(mfa::totp_confirm))
        .route("/auth/mfa/totp", delete(mfa::totp_remove))
        .route(
            "/auth/mfa/recovery/regenerate",
            post(mfa::recovery_regenerate),
        )
        .route(
            "/auth/mfa/passkeys/register/options",
            post(passkey::register_options),
        )
        .route("/auth/mfa/passkeys/register", post(passkey::register))
        .route(
            "/auth/mfa/passkeys/{id}",
            patch(passkey::rename).delete(passkey::remove),
        )
        .route("/auth/me", get(account::me).patch(account::update_profile))
        .route("/auth/logout", post(account::logout))
        .route("/auth/token/{token}", get(invite::token_info))
        .route("/auth/invite/{token}/redeem", post(invite::redeem_invite))
        .route("/auth/reset/{token}/redeem", post(invite::redeem_reset))
        .route("/auth/prefs", patch(crate::prefs::update_prefs))
        .route("/auth/welcome", post(account::finish_welcome))
        .route("/auth/change-password", post(account::change_password))
        .route("/auth/account", delete(account::delete_account))
        .route(
            "/auth/sessions",
            get(account::list_sessions).delete(account::revoke_other_sessions),
        )
        .route("/auth/sessions/{id}", delete(account::revoke_session))
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
