use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, AeadCore, KeyInit, rand_core::OsRng},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("invalid key: must be 64 hex characters (32 bytes)")]
    InvalidKey,
    #[error("encryption failed")]
    EncryptionFailed,
    #[error("decryption failed: wrong key or corrupted data")]
    DecryptionFailed,
    #[error("invalid base64")]
    InvalidBase64,
}

fn parse_key(key_hex: &str) -> Result<[u8; 32], CryptoError> {
    if key_hex.len() != 64 {
        return Err(CryptoError::InvalidKey);
    }
    let mut bytes = [0u8; 32];
    for (i, chunk) in key_hex.as_bytes().chunks(2).enumerate() {
        let s = std::str::from_utf8(chunk).map_err(|_| CryptoError::InvalidKey)?;
        bytes[i] = u8::from_str_radix(s, 16).map_err(|_| CryptoError::InvalidKey)?;
    }
    Ok(bytes)
}

/// Encrypt `plaintext` using AES-256-GCM. Returns `base64(nonce || ciphertext)`.
/// `key_hex` must be exactly 64 hex characters (32 bytes).
pub fn encrypt(key_hex: &str, plaintext: &[u8]) -> Result<String, CryptoError> {
    let key_bytes = parse_key(key_hex)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|_| CryptoError::InvalidKey)?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|_| CryptoError::EncryptionFailed)?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(STANDARD.encode(&combined))
}

/// Decrypt `blob` (base64 of nonce || ciphertext) using AES-256-GCM.
/// `key_hex` must be exactly 64 hex characters (32 bytes).
pub fn decrypt(key_hex: &str, blob: &str) -> Result<Vec<u8>, CryptoError> {
    let combined = STANDARD.decode(blob).map_err(|_| CryptoError::InvalidBase64)?;
    if combined.len() < 12 {
        return Err(CryptoError::DecryptionFailed);
    }
    let nonce_bytes: [u8; 12] = combined[..12].try_into().map_err(|_| CryptoError::DecryptionFailed)?;
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = &combined[12..];
    let key_bytes = parse_key(key_hex)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|_| CryptoError::DecryptionFailed)?;
    cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> String {
        "a".repeat(64)
    }

    #[test]
    fn roundtrip_recovers_plaintext() {
        let ct = encrypt(&key(), b"gripsou credentials").unwrap();
        assert_eq!(decrypt(&key(), &ct).unwrap(), b"gripsou credentials");
    }

    #[test]
    fn two_encryptions_differ_nonce() {
        let ct1 = encrypt(&key(), b"same").unwrap();
        let ct2 = encrypt(&key(), b"same").unwrap();
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn wrong_key_fails() {
        let ct = encrypt(&"a".repeat(64), b"secret").unwrap();
        assert!(decrypt(&"b".repeat(64), &ct).is_err());
    }

    #[test]
    fn short_key_fails() {
        assert!(encrypt("short", b"x").is_err());
        assert!(decrypt("short", "aabbcc").is_err());
    }

    #[test]
    fn bad_base64_fails() {
        assert!(decrypt(&key(), "not!valid!base64!!!").is_err());
    }
}
