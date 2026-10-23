//! Passkeys: the `PUBLIC_URL` they are bound to, adding and managing them in
//! Settings, and signing in with one (without a password, or in place of the
//! code on the second step).

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use gripsou_core::repo::{login_challenge, passkey as repo, session};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;
use webauthn_rs::prelude::{CredentialID, PasskeyRegistration, Url, Webauthn, WebauthnBuilder};
use webauthn_rs_proto::ResidentKeyRequirement;

use crate::auth::{self, AuthUser};
use crate::dto;
use crate::handlers::internal;
use crate::mfa::{ApiError, check_reauth, require_reauth};

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

const REGISTER_KIND: &str = "passkey_register";
const MAX_NAME_CHARS: usize = 64;

fn not_accepted() -> ApiError {
    (StatusCode::BAD_REQUEST, "passkey not accepted".to_string())
}

fn expired() -> ApiError {
    (StatusCode::UNAUTHORIZED, "challenge expired".to_string())
}

/// "Firefox on Linux", from the browser adding the passkey.
fn default_name(headers: &HeaderMap) -> String {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(auth::parse_user_agent)
        .unwrap_or_else(|| "Passkey".to_string())
        .chars()
        .take(MAX_NAME_CHARS)
        .collect()
}

/// Start adding a passkey. Needs a fresh reauth token, checked but not spent,
/// so a cancelled browser prompt can be retried without the password.
pub async fn register_options(
    State(pool): State<PgPool>,
    State(pk): State<Passkeys>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::ReauthTokenReq>,
) -> Result<Json<dto::PasskeyOptions>, ApiError> {
    check_reauth(&pool, user_id, &body.reauth).await?;
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "unauthorized".to_string()))?;
    let exclude: Vec<CredentialID> = repo::credential_ids(&pool, user_id)
        .await
        .map_err(internal)?
        .into_iter()
        .map(CredentialID::from)
        .collect();
    let (mut ccr, reg) =
        pk.0.start_passkey_registration(user_id, &profile.email, &profile.name, Some(exclude))
            .map_err(internal)?;
    // Passwordless sign-in finds the passkey without an email: ask for one
    // the device can offer by itself (webauthn-rs leaves it optional).
    if let Some(sel) = ccr.public_key.authenticator_selection.as_mut() {
        sel.resident_key = Some(ResidentKeyRequirement::Required);
        sel.require_resident_key = true;
    }
    let token = auth::generate_token();
    login_challenge::create(
        &pool,
        &auth::hash_token(&token),
        Some(user_id),
        REGISTER_KIND,
        serde_json::json!({ "reg": reg }),
    )
    .await
    .map_err(internal)?;
    Ok(Json(dto::PasskeyOptions {
        challenge: token,
        options: serde_json::to_value(&ccr.public_key).map_err(internal)?,
    }))
}

/// Finish adding a passkey: spends the reauth token and the ceremony in one
/// transaction (a refused credential rolls both back), then signs out the
/// user's other sessions.
pub async fn register(
    State(pool): State<PgPool>,
    State(pk): State<Passkeys>,
    headers: HeaderMap,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
    Json(body): Json<dto::PasskeyRegisterReq>,
) -> Result<Json<dto::PasskeyInfo>, ApiError> {
    let mut tx = pool.begin().await.map_err(internal)?;
    let challenge =
        login_challenge::consume(&mut *tx, &auth::hash_token(&body.challenge), REGISTER_KIND)
            .await
            .map_err(internal)?
            .filter(|c| c.user_id == Some(user_id))
            .ok_or_else(expired)?;
    require_reauth(&mut *tx, user_id, &body.reauth).await?;
    let reg: PasskeyRegistration =
        serde_json::from_value(challenge.state["reg"].clone()).map_err(internal)?;
    let passkey =
        pk.0.finish_passkey_registration(&body.credential, &reg)
            .map_err(|e| {
                tracing::warn!(user_id = %user_id, reason = %e, "passkey registration failed");
                not_accepted()
            })?;
    let stored = serde_json::to_value(&passkey).map_err(internal)?;
    let row = repo::insert(
        &mut *tx,
        user_id,
        passkey.cred_id().as_ref(),
        &stored,
        &default_name(&headers),
    )
    .await
    .map_err(internal)?
    .ok_or((StatusCode::CONFLICT, "passkey already added".to_string()))?;
    tx.commit().await.map_err(internal)?;
    session::delete_others(&pool, user_id, session_id)
        .await
        .map_err(internal)?;
    tracing::info!(user_id = %user_id, "passkey added");
    Ok(Json(row.into()))
}

pub async fn rename(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::RenamePasskeyReq>,
) -> Result<StatusCode, ApiError> {
    let name = body.name.trim();
    let len = name.chars().count();
    if len == 0 || len > MAX_NAME_CHARS {
        return Err((
            StatusCode::BAD_REQUEST,
            "name must be 1 to 64 characters".to_string(),
        ));
    }
    if !repo::rename(&pool, user_id, id, name)
        .await
        .map_err(internal)?
    {
        return Err((StatusCode::NOT_FOUND, "passkey not found".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    if !repo::delete(&pool, user_id, id).await.map_err(internal)? {
        return Err((StatusCode::NOT_FOUND, "passkey not found".to_string()));
    }
    tracing::info!(user_id = %user_id, "passkey removed");
    Ok(StatusCode::NO_CONTENT)
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
            let mut public_key: PublicKeyCredentialCreationOptions =
                serde_json::from_value(options.clone()).unwrap();
            // The software key refuses `requireResidentKey`, which a real
            // passkey honours: drop the flag so it can answer.
            if let Some(sel) = public_key.authenticator_selection.as_mut() {
                sel.require_resident_key = false;
            }
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
        // Used by the sign-in tests (next task).
        #[allow(dead_code)]
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

#[cfg(test)]
pub(crate) mod tests {
    use super::soft::{Soft, passkeys};
    use super::*;
    use crate::auth::AuthUser;
    use crate::mfa::tests::{reauth_token, seed_session, seed_user, sessions, who};
    use axum::http::{HeaderMap, HeaderValue, StatusCode};
    use sqlx::PgPool;

    fn firefox() -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
            ),
        );
        h
    }

    async fn options(
        pool: &PgPool,
        a: &AuthUser,
        reauth: &str,
    ) -> Result<dto::PasskeyOptions, (StatusCode, String)> {
        register_options(
            State(pool.clone()),
            State(passkeys()),
            who(a),
            Json(dto::ReauthTokenReq {
                reauth: reauth.into(),
            }),
        )
        .await
        .map(|j| j.0)
    }

    async fn finish(
        pool: &PgPool,
        a: &AuthUser,
        reauth: &str,
        o: &dto::PasskeyOptions,
        soft: &mut Soft,
    ) -> Result<dto::PasskeyInfo, (StatusCode, String)> {
        register(
            State(pool.clone()),
            State(passkeys()),
            firefox(),
            who(a),
            Json(dto::PasskeyRegisterReq {
                reauth: reauth.into(),
                challenge: o.challenge.clone(),
                credential: soft.register(&o.options),
            }),
        )
        .await
        .map(|j| j.0)
    }

    /// Add a passkey to `a` with a fresh password check; returns it and its credential id.
    pub(crate) async fn add_passkey(
        pool: &PgPool,
        a: &AuthUser,
        soft: &mut Soft,
    ) -> (dto::PasskeyInfo, Vec<u8>) {
        let before = gripsou_core::repo::passkey::credential_ids(pool, a.user_id)
            .await
            .unwrap();
        let reauth = reauth_token(pool, a, "hunter22").await;
        let o = options(pool, a, &reauth).await.unwrap();
        let info = finish(pool, a, &reauth, &o, soft).await.unwrap();
        let cred = gripsou_core::repo::passkey::credential_ids(pool, a.user_id)
            .await
            .unwrap()
            .into_iter()
            .find(|c| !before.contains(c))
            .unwrap();
        (info, cred)
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn adding_a_passkey_names_it_lists_it_and_signs_out_other_sessions(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let a = seed_session(&pool, u).await;
        let _other = seed_session(&pool, u).await;
        let (info, _) = add_passkey(&pool, &a, &mut Soft::new()).await;
        assert_eq!(info.name, "Firefox on Linux");
        assert_eq!(sessions(&pool, u).await, 1);
        let st = crate::mfa::status(State(pool.clone()), who(&a))
            .await
            .unwrap()
            .0;
        assert_eq!(st.passkeys.len(), 1);
        assert!(!st.totp, "a passkey doesn't turn two-factor on");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn adding_needs_a_fresh_reauth_of_the_caller(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let v = seed_user(&pool, "b@t.local").await;
        let a = seed_session(&pool, u).await;
        let b = seed_session(&pool, v).await;
        assert_eq!(
            options(&pool, &a, "nope").await.err().unwrap().0,
            StatusCode::UNAUTHORIZED
        );
        let theirs = reauth_token(&pool, &b, "hunter22").await;
        assert_eq!(
            options(&pool, &a, &theirs).await.err().unwrap().0,
            StatusCode::UNAUTHORIZED
        );
        // Options don't spend the token; finishing does.
        let reauth = reauth_token(&pool, &a, "hunter22").await;
        let o = options(&pool, &a, &reauth).await.unwrap();
        let o2 = options(&pool, &a, &reauth).await.unwrap();
        let mut soft = Soft::new();
        finish(&pool, &a, &reauth, &o2, &mut soft).await.unwrap();
        assert_eq!(
            finish(&pool, &a, &reauth, &o, &mut soft)
                .await
                .err()
                .unwrap()
                .0,
            StatusCode::UNAUTHORIZED
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_refused_credential_keeps_the_token_for_a_retry(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let a = seed_session(&pool, u).await;
        let reauth = reauth_token(&pool, &a, "hunter22").await;
        let o = options(&pool, &a, &reauth).await.unwrap();
        let o_other = options(&pool, &a, &reauth).await.unwrap();
        let mut soft = Soft::new();
        // Answer to the other ceremony's challenge: refused, nothing spent.
        let wrong = soft.register(&o_other.options);
        let err = register(
            State(pool.clone()),
            State(passkeys()),
            firefox(),
            who(&a),
            Json(dto::PasskeyRegisterReq {
                reauth: reauth.clone(),
                challenge: o.challenge.clone(),
                credential: wrong,
            }),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        finish(&pool, &a, &reauth, &o, &mut soft)
            .await
            .expect("retry works");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn rename_and_delete_are_scoped_to_the_owner(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let v = seed_user(&pool, "b@t.local").await;
        let a = seed_session(&pool, u).await;
        let b = seed_session(&pool, v).await;
        let (info, _) = add_passkey(&pool, &a, &mut Soft::new()).await;
        let ren = |s: &AuthUser, name: &str| {
            rename(
                State(pool.clone()),
                who(s),
                Path(info.id),
                Json(dto::RenamePasskeyReq { name: name.into() }),
            )
        };
        assert_eq!(ren(&b, "x").await.err().unwrap().0, StatusCode::NOT_FOUND);
        assert_eq!(
            ren(&a, "   ").await.err().unwrap().0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            ren(&a, &"x".repeat(65)).await.err().unwrap().0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(ren(&a, "  Phone  ").await.unwrap(), StatusCode::NO_CONTENT);
        let st = crate::mfa::status(State(pool.clone()), who(&a))
            .await
            .unwrap()
            .0;
        assert_eq!(st.passkeys[0].name, "Phone");
        assert_eq!(
            remove(State(pool.clone()), who(&b), Path(info.id))
                .await
                .err()
                .unwrap()
                .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            remove(State(pool.clone()), who(&a), Path(info.id))
                .await
                .unwrap(),
            StatusCode::NO_CONTENT
        );
    }
}
