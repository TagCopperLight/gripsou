//! Passkeys: the `PUBLIC_URL` they are bound to, adding and managing them in
//! Settings, and signing in with one (without a password, or in place of the
//! code on the second step).

use std::sync::Arc;
use webauthn_rs::prelude::{Url, Webauthn, WebauthnBuilder};

/// The `Webauthn` built from `PUBLIC_URL`. Always present: the server refuses
/// to start without a usable address. Every saved passkey is bound to its
/// host, so changing `PUBLIC_URL` makes them all stop working.
#[derive(Clone)]
pub struct Passkeys(pub Arc<Webauthn>);

impl Passkeys {
    /// Check the raw `PUBLIC_URL` once, at startup.
    pub fn parse(raw: Option<&str>) -> Result<Passkeys, String> {
        let raw = raw
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                "PUBLIC_URL must be set to the address gripsou is opened at \
             (e.g. https://gripsou.example.com, or http://localhost:5173 in dev)"
                    .to_string()
            })?;
        let url =
            Url::parse(raw).map_err(|_| format!("PUBLIC_URL is not a valid address: {raw}"))?;
        let host = match url.host() {
            Some(url::Host::Domain(h)) => h.to_string(),
            Some(_) => return Err("PUBLIC_URL must name a host, not an IP address".into()),
            None => return Err(format!("PUBLIC_URL is not a valid address: {raw}")),
        };
        match url.scheme() {
            "https" => {}
            "http" if host == "localhost" => {}
            _ => {
                return Err(
                    "PUBLIC_URL must start with https:// (http:// only for localhost)".into(),
                );
            }
        }
        if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
            return Err("PUBLIC_URL must be just the address, without a path (e.g. https://gripsou.example.com)".into());
        }
        let origin = Url::parse(&url.origin().ascii_serialization())
            .map_err(|_| format!("PUBLIC_URL is not a valid address: {raw}"))?;
        let webauthn = WebauthnBuilder::new(&host, &origin)
            .and_then(|b| b.rp_name("gripsou").build())
            .map_err(|e| format!("PUBLIC_URL can't be used for passkeys: {e}"))?;
        Ok(Passkeys(Arc::new(webauthn)))
    }
}

#[cfg(test)]
mod config_tests {
    use super::Passkeys;

    #[test]
    fn accepts_https_and_localhost_http() {
        for ok in [
            "https://gripsou.example.com",
            "https://gripsou.example.com/",
            "http://localhost:5173",
        ] {
            assert!(Passkeys::parse(Some(ok)).is_ok(), "{ok}");
        }
    }

    #[test]
    fn refuses_missing_insecure_ip_and_path() {
        for (raw, needle) in [
            (None, "must be set"),
            (Some(""), "must be set"),
            (Some("not a url"), "not a valid address"),
            (Some("http://gripsou.example.com"), "https://"),
            (Some("https://192.168.1.2"), "not an IP"),
            (Some("https://gripsou.example.com/app"), "without a path"),
        ] {
            let err = Passkeys::parse(raw).err().expect("refused");
            assert!(err.contains(needle), "{raw:?}: {err}");
        }
    }
}

/// A software passkey for tests, and the `Passkeys` it matches.
#[cfg(test)]
#[allow(dead_code)]
pub(crate) mod soft {
    use super::Passkeys;
    use uuid::Uuid;
    use webauthn_authenticator_rs::WebauthnAuthenticator;
    use webauthn_authenticator_rs::softpasskey::SoftPasskey;
    use webauthn_rs::prelude::{
        CreationChallengeResponse, PublicKeyCredential, RegisterPublicKeyCredential,
        RequestChallengeResponse, Url,
    };
    use webauthn_rs_proto::{
        AllowCredentials, PublicKeyCredentialCreationOptions, PublicKeyCredentialRequestOptions,
    };

    pub(crate) const TEST_URL: &str = "https://gripsou.test";

    pub(crate) fn passkeys() -> Passkeys {
        Passkeys::parse(Some(TEST_URL)).unwrap()
    }

    pub(crate) struct Soft(WebauthnAuthenticator<SoftPasskey>);

    impl Soft {
        pub(crate) fn new() -> Self {
            // `true`: claims user verification, as a real passkey's PIN or biometric does.
            Soft(WebauthnAuthenticator::new(SoftPasskey::new(true)))
        }

        /// Answer the creation options the server sent (its `options` field).
        pub(crate) fn register(
            &mut self,
            options: &serde_json::Value,
        ) -> RegisterPublicKeyCredential {
            let public_key: PublicKeyCredentialCreationOptions =
                serde_json::from_value(options.clone()).unwrap();
            self.0
                .do_registration(
                    Url::parse(TEST_URL).unwrap(),
                    CreationChallengeResponse { public_key },
                )
                .unwrap()
        }

        /// Answer request options. The software key can't pick a credential
        /// by itself or send a user handle, which a real passkey does on a
        /// passwordless sign-in: `allow` names the credential and
        /// `user_handle` fills it in (it isn't covered by the signature).
        pub(crate) fn sign(
            &mut self,
            options: &serde_json::Value,
            allow: Option<&[u8]>,
            user_handle: Option<Uuid>,
        ) -> PublicKeyCredential {
            let mut public_key: PublicKeyCredentialRequestOptions =
                serde_json::from_value(options.clone()).unwrap();
            if let Some(id) = allow {
                public_key.allow_credentials = vec![AllowCredentials {
                    type_: "public-key".into(),
                    id: id.to_vec().into(),
                    transports: None,
                }];
            }
            let mut cred = self
                .0
                .do_authentication(
                    Url::parse(TEST_URL).unwrap(),
                    RequestChallengeResponse {
                        public_key,
                        mediation: None,
                    },
                )
                .unwrap();
            if let Some(u) = user_handle {
                cred.response.user_handle = Some(u.as_bytes().to_vec().into());
            }
            cred
        }
    }
}
