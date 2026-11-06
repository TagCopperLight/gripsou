//! A connection's provider credentials at rest: the provider's JSON, sealed
//! with `ENCRYPTION_KEY` in a versioned envelope `{"v": 1, "ct": …}`.

use gripsou_core::crypto::EncryptionKey;
use serde_json::Value;

pub fn seal(key: &EncryptionKey, credentials: &Value) -> Result<Value, String> {
    let plaintext = serde_json::to_vec(credentials).map_err(|e| e.to_string())?;
    let ct = key.encrypt(&plaintext).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "v": 1, "ct": ct }))
}

/// The credentials in `sealed`. `v` is not checked: v1 is the only envelope,
/// so a v2 must add that check.
pub fn open(key: &EncryptionKey, sealed: &Value) -> Result<Value, String> {
    let ct = sealed["ct"]
        .as_str()
        .ok_or_else(|| "missing 'ct' in stored credentials".to_string())?;
    let plaintext = key.decrypt(ct).map_err(|e| e.to_string())?;
    serde_json::from_slice(&plaintext).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn key() -> EncryptionKey {
        gripsou_core::testkit::encryption_key()
    }

    fn creds() -> Value {
        json!({ "access_token": "secret-token", "id_user": 42, "nested": { "a": [1, 2] } })
    }

    /// What `complete_connection` stores, every sync must read back unchanged,
    /// or the connection silently stops syncing.
    #[test]
    fn credentials_round_trip() {
        let blob = seal(&key(), &creds()).unwrap();
        assert_eq!(open(&key(), &blob).unwrap(), creds());
    }

    #[test]
    fn stored_blob_is_the_v1_envelope_without_plaintext() {
        let blob = seal(&key(), &creds()).unwrap();
        assert_eq!(blob["v"], 1);
        assert!(blob["ct"].is_string());
        assert!(!blob.to_string().contains("secret-token"));
    }

    /// A blob without a usable `ct` (plaintext credentials, a missing or
    /// non-string `ct`, non-base64, null) is an error, never passed through
    /// to the provider as if it were credentials.
    #[test]
    fn a_malformed_blob_is_an_error() {
        for blob in [
            json!(null),
            json!({}),
            json!({ "v": 1 }),
            json!({ "v": 1, "ct": 5 }),
            json!({ "v": 1, "ct": null }),
            json!({ "v": 1, "ct": "not base64 !!" }),
            json!({ "v": 1, "ct": "" }),
            json!({ "access_token": "plain" }),
            json!("just a string"),
        ] {
            assert!(
                open(&key(), &blob).is_err(),
                "accepted malformed blob {blob}"
            );
        }
    }
}
