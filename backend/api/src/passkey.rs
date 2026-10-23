//! Passkeys: the `PUBLIC_URL` they are bound to, adding and managing them in
//! Settings, and signing in with one (without a password, or in place of the
//! code on the second step).

use axum::Json;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode};
use gripsou_core::repo::{login_challenge, passkey as repo, session};
use sqlx::PgPool;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;
use webauthn_rs::prelude::{
    CredentialID, DiscoverableAuthentication, DiscoverableKey, Passkey, PasskeyAuthentication,
    PasskeyRegistration, Url, Webauthn, WebauthnBuilder,
};
use webauthn_rs_proto::ResidentKeyRequirement;

use crate::auth::{self, AuthUser};
use crate::dto;
use crate::handlers::{LoginError, client_ip, internal, issue_session};
use crate::mfa::{ApiError, check_reauth, require_reauth};
use crate::throttle::{Blocked, LoginThrottle, SecondFactorThrottle};

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
const LOGIN_KIND: &str = "passkey_login";
/// The second login step's challenge, which a passkey ceremony rides on.
const MFA_KIND: &str = "mfa";
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

fn too_many(blocked: &Blocked) -> LoginError {
    LoginError(
        StatusCode::TOO_MANY_REQUESTS,
        "too many attempts".to_string(),
        Some(blocked.retry_after_secs()),
    )
}

/// A throttled second login step: the account is known.
fn throttled(blocked: Blocked, email: &str, ip: &str) -> LoginError {
    if blocked.first_refusal {
        tracing::warn!(email = %email, ip = %ip, reason = blocked.reason.as_str(), "login throttled");
    }
    too_many(&blocked)
}

/// A throttled passwordless sign-in: no account is known, only the IP.
fn throttled_ip(blocked: Blocked, ip: &str) -> LoginError {
    if blocked.first_refusal {
        tracing::warn!(ip = %ip, reason = blocked.reason.as_str(), "login throttled");
    }
    too_many(&blocked)
}

fn user_agent(headers: &HeaderMap) -> &str {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
}

/// Start a passwordless sign-in: the browser offers the passkeys it has for
/// this site, no email asked. Each call stores a challenge, so it is what
/// counts per IP: it reserves one failure, given back when the sign-in
/// succeeds ([`sign_in`]).
pub async fn sign_in_options(
    State(pool): State<PgPool>,
    State(pk): State<Passkeys>,
    State(throttle): State<Arc<LoginThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Result<Json<dto::PasskeyOptions>, LoginError> {
    let ip = client_ip(&headers, peer);
    throttle
        .try_ip(&ip, Instant::now())
        .map_err(|b| throttled_ip(b, &ip))?;
    let (mut rcr, state) = pk.0.start_discoverable_authentication().map_err(internal)?;
    // webauthn-rs asks for the autofill style; this runs from a button.
    rcr.mediation = None;
    let token = auth::generate_token();
    login_challenge::create(
        &pool,
        &auth::hash_token(&token),
        None,
        LOGIN_KIND,
        serde_json::json!({ "auth": state }),
    )
    .await
    .map_err(internal)?;
    Ok(Json(dto::PasskeyOptions {
        challenge: token,
        options: serde_json::to_value(&rcr.public_key).map_err(internal)?,
    }))
}

/// Finish a passwordless sign-in. The passkey's own unlock (PIN or biometric,
/// required) is the second factor, so this is a full sign-in even with
/// two-factor on. Any attempt spends the challenge. The failure its options
/// call reserved on the IP stays unless the passkey proves right.
pub async fn sign_in(
    State(pool): State<PgPool>,
    State(pk): State<Passkeys>,
    State(throttle): State<Arc<LoginThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<dto::PasskeySignInReq>,
) -> Result<Json<dto::LoginResponse>, LoginError> {
    let ip = client_ip(&headers, peer);
    let challenge = login_challenge::consume(&pool, &auth::hash_token(&body.challenge), LOGIN_KIND)
        .await
        .map_err(internal)?
        .ok_or_else(expired)?;
    let refuse = |reason: &str| {
        tracing::warn!(ip = %ip, user_agent = user_agent(&headers), reason, "passkey login failed");
        LoginError::from(not_accepted())
    };
    let state: DiscoverableAuthentication =
        serde_json::from_value(challenge.state["auth"].clone()).map_err(internal)?;
    let (user_id, cred_id) =
        pk.0.identify_discoverable_authentication(&body.credential)
            .map_err(|_| refuse("no_user"))?;
    // Only the claimed user's own passkey: a handle naming someone else finds nothing.
    let Some(row) = repo::find(&pool, user_id, cred_id)
        .await
        .map_err(internal)?
    else {
        return Err(refuse("unknown_passkey"));
    };
    let mut passkey: Passkey = serde_json::from_value(row.passkey).map_err(internal)?;
    let result =
        pk.0.finish_discoverable_authentication(
            &body.credential,
            state,
            &[DiscoverableKey::from(&passkey)],
        )
        .map_err(|_| refuse("invalid"))?;
    passkey.update_credential(&result);
    repo::record_use(
        &pool,
        row.id,
        &serde_json::to_value(&passkey).map_err(internal)?,
    )
    .await
    .map_err(internal)?;
    throttle.refund_ip(&ip);
    let resp = issue_session(&pool, &headers, peer, user_id, body.remember).await?;
    tracing::info!(user_id = %user_id, ip = %ip, user_agent = user_agent(&headers), method = "passkey", "login succeeded");
    Ok(Json(resp))
}

/// Second login step: start a passkey ceremony for the challenge's user. Its
/// state goes on the `mfa` challenge, which stays valid; a newer ceremony
/// replaces an older one.
pub async fn verify_options(
    State(pool): State<PgPool>,
    State(pk): State<Passkeys>,
    Json(body): Json<dto::ChallengeReq>,
) -> Result<Json<dto::PasskeyRequestOptions>, ApiError> {
    let hash = auth::hash_token(&body.challenge);
    let user_id = login_challenge::find_valid(&pool, &hash, MFA_KIND)
        .await
        .map_err(internal)?
        .and_then(|c| c.user_id)
        .ok_or_else(expired)?;
    let passkeys: Vec<Passkey> = repo::stored(&pool, user_id)
        .await
        .map_err(internal)?
        .into_iter()
        .map(|s| serde_json::from_value(s.passkey))
        .collect::<Result<_, _>>()
        .map_err(internal)?;
    if passkeys.is_empty() {
        return Err((StatusCode::CONFLICT, "no passkeys".to_string()));
    }
    let (rcr, state) =
        pk.0.start_passkey_authentication(&passkeys)
            .map_err(internal)?;
    let patch = serde_json::json!({ "passkey": state });
    if !login_challenge::merge_state(&pool, &hash, MFA_KIND, patch)
        .await
        .map_err(internal)?
    {
        return Err(expired());
    }
    Ok(Json(dto::PasskeyRequestOptions {
        options: serde_json::to_value(&rcr.public_key).map_err(internal)?,
    }))
}

/// Second login step with a passkey. Counted like a code: per account on the
/// second-factor throttle and per IP. A failure leaves the challenge usable.
pub async fn verify(
    State(pool): State<PgPool>,
    State(pk): State<Passkeys>,
    State(throttle): State<Arc<LoginThrottle>>,
    State(sf_throttle): State<Arc<SecondFactorThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<dto::LoginVerifyPasskeyReq>,
) -> Result<Json<dto::LoginResponse>, LoginError> {
    let ip = client_ip(&headers, peer);
    let hash = auth::hash_token(&body.challenge);
    let challenge = login_challenge::find_valid(&pool, &hash, MFA_KIND)
        .await
        .map_err(internal)?
        .ok_or_else(expired)?;
    let user_id = challenge.user_id.ok_or_else(expired)?;
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await
        .map_err(internal)?
        .ok_or_else(expired)?;
    sf_throttle
        .try_login(&throttle, &profile.email, &ip, Instant::now())
        .map_err(|b| throttled(b, &profile.email, &ip))?;
    let refuse = || {
        tracing::warn!(email = %profile.email, ip = %ip, user_agent = user_agent(&headers), step = "second_factor", method = "passkey", "login failed");
        LoginError::from(not_accepted())
    };
    // No ceremony started on this challenge.
    let Some(state) = challenge.state.get("passkey").cloned() else {
        return Err(refuse());
    };
    let state: PasskeyAuthentication = serde_json::from_value(state).map_err(internal)?;
    let Some(row) = repo::find(&pool, user_id, body.credential.get_credential_id())
        .await
        .map_err(internal)?
    else {
        return Err(refuse());
    };
    let mut passkey: Passkey = serde_json::from_value(row.passkey).map_err(internal)?;
    let result =
        pk.0.finish_passkey_authentication(&body.credential, &state)
            .map_err(|_| refuse())?;
    passkey.update_credential(&result);
    // A parallel request that already spent the challenge wins; this one
    // rolls back without recording the use.
    let mut tx = pool.begin().await.map_err(internal)?;
    let challenge = login_challenge::consume(&mut *tx, &hash, MFA_KIND)
        .await
        .map_err(internal)?
        .ok_or_else(expired)?;
    repo::record_use(
        &mut *tx,
        row.id,
        &serde_json::to_value(&passkey).map_err(internal)?,
    )
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    sf_throttle.record_login_success(&throttle, &profile.email, &ip);
    let remember = challenge
        .state
        .get("remember")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let resp = issue_session(&pool, &headers, peer, user_id, remember).await?;
    tracing::info!(user_id = %user_id, ip = %ip, user_agent = user_agent(&headers), method = "passkey", "login succeeded");
    Ok(Json(resp))
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
    use crate::handlers::LoginError;
    use crate::mfa::tests::reauth_token;
    use crate::testkit::{seed_session, seed_user, sessions, who};
    use crate::throttle::LoginThrottle;
    use axum::http::{HeaderMap, HeaderValue, StatusCode};
    use sqlx::PgPool;
    use std::sync::Arc;

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

    #[sqlx::test(migrations = "../migrations")]
    async fn options_require_what_passwordless_needs_and_exclude_existing(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let a = seed_session(&pool, u).await;
        let reauth = reauth_token(&pool, &a, "hunter22").await;
        let o = options(&pool, &a, &reauth).await.unwrap();
        let sel = &o.options["authenticatorSelection"];
        assert_eq!(sel["residentKey"], "required");
        assert_eq!(sel["requireResidentKey"], true);
        assert_eq!(sel["userVerification"], "required");

        let (_, cred) = add_passkey(&pool, &a, &mut Soft::new()).await;
        let reauth = reauth_token(&pool, &a, "hunter22").await;
        let o2 = options(&pool, &a, &reauth).await.unwrap();
        let excluded: Vec<webauthn_rs::prelude::CredentialID> = serde_json::from_value(
            o2.options["excludeCredentials"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c["id"].clone())
                .collect(),
        )
        .unwrap();
        assert_eq!(excluded.len(), 1);
        assert_eq!(excluded[0].as_ref(), cred.as_slice());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_credential_already_saved_is_a_conflict_and_keeps_the_token(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let v = seed_user(&pool, "b@t.local").await;
        let a = seed_session(&pool, u).await;
        let reauth = reauth_token(&pool, &a, "hunter22").await;
        let o = options(&pool, &a, &reauth).await.unwrap();
        let mut soft = Soft::new();
        let credential = soft.register(&o.options);
        let cred_id: &[u8] = credential.raw_id.as_ref();
        repo::insert(&pool, v, cred_id, &serde_json::json!({}), "theirs")
            .await
            .unwrap()
            .unwrap();
        let err = register(
            State(pool.clone()),
            State(passkeys()),
            firefox(),
            who(&a),
            Json(dto::PasskeyRegisterReq {
                reauth: reauth.clone(),
                challenge: o.challenge.clone(),
                credential,
            }),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(err.0, StatusCode::CONFLICT);
        // The transaction rolled back: the token and the ceremony are intact.
        check_reauth(&pool, u, &reauth).await.expect("token kept");
        assert_eq!(repo::list(&pool, u).await.unwrap().len(), 0);
    }

    fn peer() -> axum::extract::ConnectInfo<std::net::SocketAddr> {
        axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap())
    }

    async fn start_passwordless(
        pool: &PgPool,
        t: &Arc<LoginThrottle>,
    ) -> Result<dto::PasskeyOptions, LoginError> {
        sign_in_options(
            State(pool.clone()),
            State(passkeys()),
            State(t.clone()),
            firefox(),
            peer(),
        )
        .await
        .map(|j| j.0)
    }

    async fn passwordless(
        pool: &PgPool,
        t: &Arc<LoginThrottle>,
        soft: &mut Soft,
        cred: &[u8],
        user: Uuid,
    ) -> Result<dto::LoginResponse, LoginError> {
        let o = start_passwordless(pool, t).await?;
        let credential = soft.sign(&o.options, Some(cred), Some(user));
        sign_in(
            State(pool.clone()),
            State(passkeys()),
            State(t.clone()),
            firefox(),
            peer(),
            Json(dto::PasskeySignInReq {
                challenge: o.challenge,
                credential,
                remember: true,
            }),
        )
        .await
        .map(|j| j.0)
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn passwordless_sign_in_makes_a_session_and_records_the_use(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let a = seed_session(&pool, u).await;
        let mut soft = Soft::new();
        let (_, cred) = add_passkey(&pool, &a, &mut soft).await;
        let t = Arc::new(LoginThrottle::default());
        let resp = passwordless(&pool, &t, &mut soft, &cred, u)
            .await
            .expect("signed in");
        assert_eq!(resp.user.email, "a@t.local");
        assert_eq!(sessions(&pool, u).await, 2);
        let st = crate::mfa::status(State(pool.clone()), who(&a))
            .await
            .unwrap()
            .0;
        assert!(st.passkeys[0].last_used_at.is_some());
        // Works again: the stored sign counter was updated, not left behind.
        passwordless(&pool, &t, &mut soft, &cred, u)
            .await
            .expect("second sign-in");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn passwordless_refuses_a_deleted_passkey_a_wrong_user_and_a_reused_challenge(
        pool: PgPool,
    ) {
        let u = seed_user(&pool, "a@t.local").await;
        let v = seed_user(&pool, "b@t.local").await;
        let a = seed_session(&pool, u).await;
        let mut soft = Soft::new();
        let (info, cred) = add_passkey(&pool, &a, &mut soft).await;
        let t = Arc::new(LoginThrottle::default());
        // Claims to be another user: that user has no such passkey.
        let e = passwordless(&pool, &t, &mut soft, &cred, v)
            .await
            .err()
            .unwrap();
        assert_eq!(
            (e.0, e.1.as_str()),
            (StatusCode::BAD_REQUEST, "passkey not accepted")
        );
        // A challenge is spent by any attempt.
        let o = start_passwordless(&pool, &t).await.unwrap();
        let c1 = soft.sign(&o.options, Some(&cred), Some(u));
        let c2 = soft.sign(&o.options, Some(&cred), Some(u));
        let req = |credential| {
            Json(dto::PasskeySignInReq {
                challenge: o.challenge.clone(),
                credential,
                remember: false,
            })
        };
        let first = sign_in(
            State(pool.clone()),
            State(passkeys()),
            State(t.clone()),
            firefox(),
            peer(),
            req(c1),
        )
        .await
        .expect("first answer signs in")
        .0;
        assert_eq!(first.user.email, "a@t.local");
        let e = sign_in(
            State(pool.clone()),
            State(passkeys()),
            State(t.clone()),
            firefox(),
            peer(),
            req(c2),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(
            (e.0, e.1.as_str()),
            (StatusCode::UNAUTHORIZED, "challenge expired")
        );
        remove(State(pool.clone()), who(&a), Path(info.id))
            .await
            .unwrap();
        let e = passwordless(&pool, &t, &mut soft, &cred, u)
            .await
            .err()
            .unwrap();
        assert_eq!(e.0, StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn passwordless_failures_are_throttled_per_ip(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let v = seed_user(&pool, "b@t.local").await;
        let a = seed_session(&pool, u).await;
        let mut soft = Soft::new();
        let (_, cred) = add_passkey(&pool, &a, &mut soft).await;
        let t = Arc::new(LoginThrottle::default());
        // The IP policy's free failures (30): each is let through and refused.
        // The options call counted it; the refusal adds nothing.
        for _ in 0..crate::throttle::IP.free_failures {
            let e = passwordless(&pool, &t, &mut soft, &cred, v)
                .await
                .err()
                .unwrap();
            assert_eq!(e.0, StatusCode::BAD_REQUEST);
        }
        let e = passwordless(&pool, &t, &mut soft, &cred, u)
            .await
            .err()
            .unwrap();
        assert_eq!(e.0, StatusCode::TOO_MANY_REQUESTS);
        assert!(e.2.is_some());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn passwordless_options_alone_are_throttled_per_ip(pool: PgPool) {
        let t = Arc::new(LoginThrottle::default());
        for _ in 0..crate::throttle::IP.free_failures {
            start_passwordless(&pool, &t).await.expect("let through");
        }
        let e = start_passwordless(&pool, &t).await.err().unwrap();
        assert_eq!(e.0, StatusCode::TOO_MANY_REQUESTS);
        assert!(e.2.is_some_and(|s| s > 0), "says how long to wait");
        // Refused before storing anything: no challenge row for it.
        let stored: i64 =
            sqlx::query_scalar("select count(*) from login_challenge where kind = $1")
                .bind(LOGIN_KIND)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored, i64::from(crate::throttle::IP.free_failures));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_passwordless_success_gives_back_its_ip_attempt(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let v = seed_user(&pool, "b@t.local").await;
        let a = seed_session(&pool, u).await;
        let mut soft = Soft::new();
        let (_, cred) = add_passkey(&pool, &a, &mut soft).await;
        let t = Arc::new(LoginThrottle::default());
        for _ in 0..crate::throttle::IP.free_failures - 1 {
            let _ = passwordless(&pool, &t, &mut soft, &cred, v).await;
        }
        passwordless(&pool, &t, &mut soft, &cred, u)
            .await
            .expect("signed in");
        // Without the refund the IP would now be waiting.
        passwordless(&pool, &t, &mut soft, &cred, u)
            .await
            .expect("not throttled");
    }

    fn b64(bytes: &[u8]) -> String {
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }

    /// A registration answer as `@simplewebauthn/browser` v14 posts it
    /// (`RegistrationResponseJSON`), extra fields included.
    fn browser_registration(
        c: &webauthn_rs::prelude::RegisterPublicKeyCredential,
    ) -> serde_json::Value {
        serde_json::json!({
            "id": c.id,
            "rawId": b64(c.raw_id.as_ref()),
            "response": {
                "clientDataJSON": b64(c.response.client_data_json.as_ref()),
                "attestationObject": b64(c.response.attestation_object.as_ref()),
                "authenticatorData": b64(b"authenticator data"),
                "transports": ["internal", "hybrid"],
                "publicKeyAlgorithm": -7,
                "publicKey": b64(b"spki public key"),
            },
            "authenticatorAttachment": "platform",
            "clientExtensionResults": { "credProps": { "rk": true } },
            "type": "public-key",
        })
    }

    /// A sign-in answer as `@simplewebauthn/browser` v14 posts it
    /// (`AuthenticationResponseJSON`).
    fn browser_authentication(c: &webauthn_rs::prelude::PublicKeyCredential) -> serde_json::Value {
        serde_json::json!({
            "id": c.id,
            "rawId": b64(c.raw_id.as_ref()),
            "response": {
                "clientDataJSON": b64(c.response.client_data_json.as_ref()),
                "authenticatorData": b64(c.response.authenticator_data.as_ref()),
                "signature": b64(c.response.signature.as_ref()),
                "userHandle": c.response.user_handle.as_ref().map(|h| b64(h.as_ref())),
            },
            "authenticatorAttachment": "platform",
            "clientExtensionResults": {},
            "type": "public-key",
        })
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn the_browser_librarys_json_is_accepted(pool: PgPool) {
        let u = seed_user(&pool, "a@t.local").await;
        let a = seed_session(&pool, u).await;
        let mut soft = Soft::new();
        let reauth = reauth_token(&pool, &a, "hunter22").await;
        let o = options(&pool, &a, &reauth).await.unwrap();
        let body: dto::PasskeyRegisterReq = serde_json::from_value(serde_json::json!({
            "reauth": reauth,
            "challenge": o.challenge,
            "credential": browser_registration(&soft.register(&o.options)),
        }))
        .expect("registration JSON parses");
        let info = register(
            State(pool.clone()),
            State(passkeys()),
            firefox(),
            who(&a),
            Json(body),
        )
        .await
        .expect("registered")
        .0;
        assert_eq!(info.name, "Firefox on Linux");
        let cred = repo::credential_ids(&pool, u).await.unwrap().remove(0);

        let t = Arc::new(LoginThrottle::default());
        let o = start_passwordless(&pool, &t).await.unwrap();
        let body: dto::PasskeySignInReq = serde_json::from_value(serde_json::json!({
            "challenge": o.challenge,
            "credential": browser_authentication(&soft.sign(&o.options, Some(&cred), Some(u))),
            "remember": false,
        }))
        .expect("sign-in JSON parses");
        let resp = sign_in(
            State(pool.clone()),
            State(passkeys()),
            State(t.clone()),
            firefox(),
            peer(),
            Json(body),
        )
        .await
        .expect("signed in")
        .0;
        assert_eq!(resp.user.email, "a@t.local");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn methods_offer_a_passkey_only_with_two_factor_on(pool: PgPool) {
        use crate::handlers::auth_tests::{Throttles, enable_totp, login_outcome};
        let u = seed_user(&pool, "a@t.local").await;
        let a = seed_session(&pool, u).await;
        add_passkey(&pool, &a, &mut Soft::new()).await;
        let t = Throttles::default();
        assert!(
            matches!(
                login_outcome(&pool, &t, "a@t.local", "hunter22", false).await,
                dto::LoginOutcome::Session(_)
            ),
            "passkey without two-factor: the password is enough"
        );
        enable_totp(&pool, u).await;
        match login_outcome(&pool, &t, "a@t.local", "hunter22", false).await {
            dto::LoginOutcome::Mfa(m) => {
                assert_eq!(m.methods, vec!["totp", "recovery", "passkey"])
            }
            other => panic!("expected mfa, got {other:?}"),
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn code_step_passkey_gives_a_session_with_the_remember_choice(pool: PgPool) {
        use crate::handlers::auth_tests::{Throttles, enable_totp, login_outcome};
        let u = seed_user(&pool, "a@t.local").await;
        let a = seed_session(&pool, u).await;
        let mut soft = Soft::new();
        add_passkey(&pool, &a, &mut soft).await;
        enable_totp(&pool, u).await;
        let t = Throttles::default();
        let dto::LoginOutcome::Mfa(m) =
            login_outcome(&pool, &t, "a@t.local", "hunter22", true).await
        else {
            panic!("expected mfa")
        };
        let start = || {
            verify_options(
                State(pool.clone()),
                State(passkeys()),
                Json(dto::ChallengeReq {
                    challenge: m.challenge.clone(),
                }),
            )
        };
        let o = start().await.unwrap().0;
        // A newer ceremony replaces the older one.
        let other = start().await.unwrap().0;
        let call = |credential| {
            verify(
                State(pool.clone()),
                State(passkeys()),
                State(t.pw.clone()),
                State(t.sf.clone()),
                firefox(),
                peer(),
                Json(dto::LoginVerifyPasskeyReq {
                    challenge: m.challenge.clone(),
                    credential,
                }),
            )
        };
        let stale = soft.sign(&o.options, None, None);
        let e = call(stale).await.err().unwrap();
        assert_eq!(
            (e.0, e.1.as_str()),
            (StatusCode::BAD_REQUEST, "passkey not accepted"),
            "only the latest ceremony counts"
        );
        // The refusal left the mfa challenge usable.
        let good = soft.sign(&other.options, None, None);
        let resp = call(good).await.expect("signed in").0;
        assert_eq!(resp.user.email, "a@t.local");
        let remembered: bool = sqlx::query_scalar(
            "select remembered from session where user_id = $1 order by created_at desc limit 1",
        )
        .bind(u)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(remembered);
        let st = crate::mfa::status(State(pool.clone()), who(&a))
            .await
            .unwrap()
            .0;
        assert!(st.passkeys[0].last_used_at.is_some());
        // The challenge is spent now.
        let again = start().await.err().unwrap();
        assert_eq!(again.0, StatusCode::UNAUTHORIZED);
    }

    /// `a@t.local` with a passkey and two-factor on, past the password step;
    /// `b@t.local` with a passkey of its own. Returns the throttles, the mfa
    /// challenge, both keys and b's credential id.
    async fn code_step_with_a_stranger(
        pool: &PgPool,
    ) -> (
        crate::handlers::auth_tests::Throttles,
        String,
        Soft,
        Soft,
        Vec<u8>,
    ) {
        use crate::handlers::auth_tests::{Throttles, enable_totp, login_outcome};
        let u = seed_user(pool, "a@t.local").await;
        let v = seed_user(pool, "b@t.local").await;
        let a = seed_session(pool, u).await;
        let b = seed_session(pool, v).await;
        let mut mine = Soft::new();
        add_passkey(pool, &a, &mut mine).await;
        let mut theirs = Soft::new();
        let (_, their_cred) = add_passkey(pool, &b, &mut theirs).await;
        enable_totp(pool, u).await;
        let t = Throttles::default();
        let dto::LoginOutcome::Mfa(m) =
            login_outcome(pool, &t, "a@t.local", "hunter22", false).await
        else {
            panic!("expected mfa")
        };
        (t, m.challenge, mine, theirs, their_cred)
    }

    async fn code_step(
        pool: &PgPool,
        t: &crate::handlers::auth_tests::Throttles,
        challenge: &str,
        sign: impl FnOnce(&serde_json::Value) -> webauthn_rs::prelude::PublicKeyCredential,
    ) -> Result<dto::LoginResponse, LoginError> {
        let o = verify_options(
            State(pool.clone()),
            State(passkeys()),
            Json(dto::ChallengeReq {
                challenge: challenge.into(),
            }),
        )
        .await
        .map_err(LoginError::from)?
        .0;
        verify(
            State(pool.clone()),
            State(passkeys()),
            State(t.pw.clone()),
            State(t.sf.clone()),
            firefox(),
            peer(),
            Json(dto::LoginVerifyPasskeyReq {
                challenge: challenge.into(),
                credential: sign(&o.options),
            }),
        )
        .await
        .map(|j| j.0)
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn code_step_refuses_another_users_passkey_and_keeps_the_challenge(pool: PgPool) {
        let (t, challenge, mut mine, mut theirs, their_cred) =
            code_step_with_a_stranger(&pool).await;
        let e = code_step(&pool, &t, &challenge, |o| {
            theirs.sign(o, Some(&their_cred), None)
        })
        .await
        .err()
        .unwrap();
        assert_eq!(
            (e.0, e.1.as_str()),
            (StatusCode::BAD_REQUEST, "passkey not accepted")
        );
        let resp = code_step(&pool, &t, &challenge, |o| mine.sign(o, None, None))
            .await
            .expect("the challenge is still usable");
        assert_eq!(resp.user.email, "a@t.local");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn code_step_passkey_failures_wait_on_the_second_factor_limiter(pool: PgPool) {
        let (t, challenge, mut mine, mut theirs, their_cred) =
            code_step_with_a_stranger(&pool).await;
        for _ in 0..crate::throttle::SECOND_FACTOR.free_failures {
            let e = code_step(&pool, &t, &challenge, |o| {
                theirs.sign(o, Some(&their_cred), None)
            })
            .await
            .err()
            .unwrap();
            assert_eq!(e.0, StatusCode::BAD_REQUEST);
        }
        // Even the right passkey now waits.
        let e = code_step(&pool, &t, &challenge, |o| mine.sign(o, None, None))
            .await
            .err()
            .unwrap();
        assert_eq!(e.0, StatusCode::TOO_MANY_REQUESTS);
        assert!(e.2.is_some_and(|s| s > 0), "says how long to wait");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn code_step_options_need_a_live_mfa_challenge(pool: PgPool) {
        let e = verify_options(
            State(pool.clone()),
            State(passkeys()),
            Json(dto::ChallengeReq {
                challenge: "nope".into(),
            }),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(e.0, StatusCode::UNAUTHORIZED);
    }
}
