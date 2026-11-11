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

use crate::routes::Routes;

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

/// Compares two secrets in a time that depends on their length only, so a
/// guess learns nothing from how fast it is refused.
pub(crate) fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// [`hash_token`], base64url-encoded, for the `invite_token.token` text column.
pub fn hash_token_str(token: &str) -> String {
    URL_SAFE_NO_PAD.encode(hash_token(token))
}

pub(crate) fn routes() -> Routes {
    Routes::default()
        .post("/auth/login", login::login)
        .post("/auth/login/verify", login::login_verify)
        .post("/auth/passkey/options", passkey::sign_in_options)
        .post("/auth/passkey", passkey::sign_in)
        .post("/auth/reauth", mfa::reauth)
        .get("/auth/mfa/status", mfa::status)
        .post("/auth/mfa/totp/setup", mfa::totp_setup)
        .post("/auth/mfa/totp/confirm", mfa::totp_confirm)
        .delete("/auth/mfa/totp", mfa::totp_remove)
        .post("/auth/mfa/recovery/regenerate", mfa::recovery_regenerate)
        .post(
            "/auth/mfa/passkeys/register/options",
            passkey::register_options,
        )
        .post("/auth/mfa/passkeys/register", passkey::register)
        .patch("/auth/mfa/passkeys/{id}", passkey::rename)
        .delete("/auth/mfa/passkeys/{id}", passkey::remove)
        .get("/auth/me", account::me)
        .patch("/auth/me", account::update_profile)
        .post("/auth/logout", account::logout)
        .get("/auth/token/{token}", invite::token_info)
        .post("/auth/invite/{token}/redeem", invite::redeem_invite)
        .post("/auth/reset/{token}/redeem", invite::redeem_reset)
        .patch("/auth/prefs", crate::prefs::update_prefs)
        .post("/auth/welcome", account::finish_welcome)
        .post("/auth/change-password", account::change_password)
        .delete("/auth/account", account::delete_account)
        .get("/auth/sessions", account::list_sessions)
        .delete("/auth/sessions", account::revoke_other_sessions)
        .delete("/auth/sessions/{id}", account::revoke_session)
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
