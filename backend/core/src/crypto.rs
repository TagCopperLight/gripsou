use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, AeadCore, KeyInit, rand_core::OsRng},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("encryption failed")]
    EncryptionFailed,
    #[error("decryption failed: wrong key or corrupted data")]
    DecryptionFailed,
    #[error("invalid base64")]
    InvalidBase64,
}

/// `ENCRYPTION_KEY`, parsed once at startup: it encrypts provider
/// credentials and authenticator secrets. Its `Debug` never shows the bytes.
#[derive(Clone)]
pub struct EncryptionKey([u8; 32]);

impl std::fmt::Debug for EncryptionKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EncryptionKey(..)")
    }
}

impl EncryptionKey {
    /// Check the raw `ENCRYPTION_KEY` value. The error says what is wrong
    /// without ever repeating the value.
    pub fn parse(raw: Option<&str>) -> Result<EncryptionKey, String> {
        match raw {
            None | Some("") => Err(
                "ENCRYPTION_KEY must be set (generate one with `openssl rand -hex 32`)".into(),
            ),
            Some(k) => from_hex(k).map(EncryptionKey).ok_or_else(|| {
                "ENCRYPTION_KEY is not a valid key: expected 64 hex characters (`openssl rand -hex 32`)"
                    .into()
            }),
        }
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new(&self.0.into())
    }

    /// Encrypt `plaintext` using AES-256-GCM. Returns `base64(nonce || ciphertext)`.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<String, CryptoError> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = self
            .cipher()
            .encrypt(&nonce, plaintext)
            .map_err(|_| CryptoError::EncryptionFailed)?;
        let mut combined = nonce.to_vec();
        combined.extend_from_slice(&ciphertext);
        Ok(STANDARD.encode(&combined))
    }

    /// Decrypt `blob` (base64 of nonce || ciphertext) using AES-256-GCM.
    pub fn decrypt(&self, blob: &str) -> Result<Vec<u8>, CryptoError> {
        let combined = STANDARD
            .decode(blob)
            .map_err(|_| CryptoError::InvalidBase64)?;
        if combined.len() < 12 {
            return Err(CryptoError::DecryptionFailed);
        }
        let (nonce, ciphertext) = combined.split_at(12);
        self.cipher()
            .decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|_| CryptoError::DecryptionFailed)
    }
}

/// The 32 bytes of `key_hex`, unless it is not exactly 64 hex characters.
fn from_hex(key_hex: &str) -> Option<[u8; 32]> {
    if key_hex.len() != 64 {
        return None;
    }
    let mut bytes = [0u8; 32];
    for (i, chunk) in key_hex.as_bytes().chunks(2).enumerate() {
        let s = std::str::from_utf8(chunk).ok()?;
        bytes[i] = u8::from_str_radix(s, 16).ok()?;
    }
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    fn key(c: &str) -> EncryptionKey {
        EncryptionKey::parse(Some(&c.repeat(64))).unwrap()
    }

    #[test]
    fn roundtrip_recovers_plaintext() {
        let ct = key("a").encrypt(b"gripsou credentials").unwrap();
        assert_eq!(key("a").decrypt(&ct).unwrap(), b"gripsou credentials");
    }

    #[test]
    fn two_encryptions_differ_nonce() {
        let ct1 = key("a").encrypt(b"same").unwrap();
        let ct2 = key("a").encrypt(b"same").unwrap();
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn wrong_key_fails() {
        let ct = key("a").encrypt(b"secret").unwrap();
        assert!(key("b").decrypt(&ct).is_err());
    }

    #[test]
    fn bad_base64_fails() {
        assert!(key("a").decrypt("not!valid!base64!!!").is_err());
    }

    #[test]
    fn a_malformed_key_is_refused_without_its_value() {
        let zz = "zz".repeat(32);
        for raw in ["short", "not-a-hex-key-value", &zz, &format!("{GOOD}00")] {
            let err = EncryptionKey::parse(Some(raw)).err().unwrap();
            assert!(err.contains("not a valid key"), "{err}");
            assert!(!err.contains(raw));
        }
    }
}
