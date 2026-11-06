//! Authentication. Opaque tokens (sessions, challenges, invite and reset
//! links) are random strings handed to the client once: only their SHA-256
//! hash is stored.

pub mod account;
pub mod challenge;
pub mod client;
pub mod factors;
pub mod invite;
pub mod login;
pub mod mfa;
pub mod passkey;
pub mod password;
pub mod session;
pub mod throttle;

pub use session::{AdminUser, AuthUser};

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
