//! Two-factor settings: set up and remove an authenticator app, regenerate
//! backup codes, and the password re-authentication the destructive steps need.

use axum::Json;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use chrono::Utc;
use gripsou_core::repo::{login_challenge, mfa, session};
use sqlx::PgPool;
use std::net::SocketAddr;
use std::sync::Arc;
use uuid::Uuid;

use crate::auth::{self, AuthUser};
use crate::dto;
use crate::handlers::{LoginError, client_ip, internal};
use crate::throttle::{LoginThrottle, SecondFactorThrottle};
use crate::{TotpKey, factors};

const REAUTH_KIND: &str = "reauth";

pub(crate) type ApiError = (StatusCode, String);

fn unauthorized() -> ApiError {
    (StatusCode::UNAUTHORIZED, "unauthorized".to_string())
}

/// Consume a reauth token. Single use either way: a token that belongs to
/// someone else is burnt and refused. Runs on a pool or in a transaction.
pub(crate) async fn require_reauth(
    db: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
    token: &str,
) -> Result<(), ApiError> {
    let challenge = login_challenge::consume(db, &auth::hash_token(token), REAUTH_KIND)
        .await
        .map_err(internal)?;
    match challenge {
        Some(c) if c.user_id == Some(user_id) => Ok(()),
        _ => Err(reauth_required()),
    }
}

/// Check a reauth token without spending it (a ceremony that finishes later
/// spends it).
pub(crate) async fn check_reauth(
    pool: &PgPool,
    user_id: Uuid,
    token: &str,
) -> Result<(), ApiError> {
    match login_challenge::find_valid(pool, &auth::hash_token(token), REAUTH_KIND)
        .await
        .map_err(internal)?
    {
        Some(c) if c.user_id == Some(user_id) => Ok(()),
        _ => Err(reauth_required()),
    }
}

fn reauth_required() -> ApiError {
    (
        StatusCode::UNAUTHORIZED,
        "reauthentication required".to_string(),
    )
}

/// Check the signed-in user's password on the login throttle, keyed on their
/// email like a login, so a stolen session guesses no faster than the login
/// form allows.
pub(crate) async fn check_password(
    pool: &PgPool,
    throttle: &LoginThrottle,
    headers: &HeaderMap,
    peer: SocketAddr,
    user_id: Uuid,
    password: &str,
) -> Result<(), LoginError> {
    let profile = gripsou_core::repo::user::profile_by_id(pool, user_id)
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)?;
    let ip = client_ip(headers, peer);
    if let Err(blocked) = throttle.try_attempt(&profile.email, &ip, std::time::Instant::now()) {
        if blocked.first_refusal {
            tracing::warn!(email = %profile.email, ip = %ip, reason = blocked.reason.as_str(), "login throttled");
        }
        return Err(LoginError(
            StatusCode::TOO_MANY_REQUESTS,
            "too many attempts".to_string(),
            Some(blocked.retry_after_secs()),
        ));
    }
    let hash = gripsou_core::repo::user::password_hash(pool, user_id)
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)?;
    if !auth::verify_password(password, &hash) {
        tracing::warn!(user_id = %user_id, ip = %ip, "password check failed");
        return Err(LoginError(
            StatusCode::BAD_REQUEST,
            "password is incorrect".to_string(),
            None,
        ));
    }
    throttle.record_success(&profile.email, &ip);
    Ok(())
}

/// Trade the password for a short-lived token that authorises one sensitive
/// change (a second factor, a reset link).
pub async fn reauth(
    State(pool): State<PgPool>,
    State(throttle): State<Arc<LoginThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::ReauthReq>,
) -> Result<Json<dto::ReauthResponse>, LoginError> {
    check_password(&pool, &throttle, &headers, peer, user_id, &body.password).await?;
    let token = auth::generate_token();
    // `create` expires the challenge in 5 minutes.
    login_challenge::create(
        &pool,
        &auth::hash_token(&token),
        Some(user_id),
        REAUTH_KIND,
        serde_json::json!({}),
    )
    .await
    .map_err(internal)?;
    Ok(Json(dto::ReauthResponse { reauth: token }))
}

pub async fn status(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<dto::MfaStatus>, ApiError> {
    let st = mfa::status(&pool, user_id).await.map_err(internal)?;
    Ok(Json(dto::MfaStatus {
        totp: st.totp,
        recovery_remaining: st.recovery_remaining,
        passkeys: gripsou_core::repo::passkey::list(&pool, user_id)
            .await
            .map_err(internal)?
            .into_iter()
            .map(Into::into)
            .collect(),
    }))
}

/// Start (or restart) enrolment: a fresh secret replaces any unconfirmed one
/// and restarts its 10-minute confirmation window.
/// Needs a fresh reauth token: otherwise a stolen session could enrol its own
/// authenticator and lock the owner out. The check that needs no password
/// (already set up) comes first, so it doesn't spend the token.
pub async fn totp_setup(
    State(pool): State<PgPool>,
    State(key): State<TotpKey>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::ReauthTokenReq>,
) -> Result<Json<dto::TotpSetup>, ApiError> {
    let key = &*key.0;
    let already = || {
        (
            StatusCode::CONFLICT,
            "authenticator already set up".to_string(),
        )
    };
    if mfa::status(&pool, user_id).await.map_err(internal)?.totp {
        return Err(already());
    }
    require_reauth(&pool, user_id, &body.reauth).await?;
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)?;
    let secret = factors::new_totp_secret();
    let enc = gripsou_core::crypto::encrypt(key, &secret).map_err(internal)?;
    // Still refuses to replace a confirmed row, should one appear meanwhile.
    if !mfa::upsert_unconfirmed_totp(&pool, user_id, &enc)
        .await
        .map_err(internal)?
    {
        return Err(already());
    }
    let qr_svg =
        factors::qr_svg(&factors::otpauth_uri(&secret, &profile.email)).map_err(internal)?;
    Ok(Json(dto::TotpSetup {
        secret: factors::base32_secret(&secret),
        qr_svg,
    }))
}

/// Prove the app works by entering a code; turns the factor on, hands out the
/// backup codes once, and signs out every other session. Only a setup started
/// in the last 10 minutes can be confirmed, and wrong codes count on the
/// second-factor throttle: a stolen session (which can't start a setup without
/// the password) must not be able to guess its way into a setup the owner
/// abandoned, and so to the backup codes.
pub async fn totp_confirm(
    State(pool): State<PgPool>,
    State(key): State<TotpKey>,
    State(sf_throttle): State<Arc<SecondFactorThrottle>>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
    Json(body): Json<dto::TotpConfirmReq>,
) -> Result<Json<dto::RecoveryCodes>, LoginError> {
    let key = &*key.0;
    let no_setup = || (StatusCode::CONFLICT, "no setup in progress".to_string());
    let row = mfa::totp(&pool, user_id)
        .await
        .map_err(internal)?
        .filter(|r| r.pending)
        .ok_or_else(no_setup)?;
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)?;
    if let Err(blocked) = sf_throttle.try_attempt(&profile.email, std::time::Instant::now()) {
        if blocked.first_refusal {
            tracing::warn!(email = %profile.email, user_id = %user_id, reason = blocked.reason.as_str(), "login throttled");
        }
        return Err(LoginError(
            StatusCode::TOO_MANY_REQUESTS,
            "too many attempts".to_string(),
            Some(blocked.retry_after_secs()),
        ));
    }
    let secret = gripsou_core::crypto::decrypt(key, &row.secret_enc).map_err(internal)?;
    let now = Utc::now().timestamp().max(0) as u64;
    let Some(step) = factors::match_totp(&secret, &body.code, now) else {
        tracing::warn!(user_id = %user_id, "totp confirm failed");
        return Err(LoginError(
            StatusCode::BAD_REQUEST,
            "invalid code".to_string(),
            None,
        ));
    };
    let codes = factors::new_recovery_codes();
    let hashes: Vec<Vec<u8>> = codes
        .iter()
        .map(|c| factors::hash_recovery_code(c))
        .collect();
    if !mfa::confirm_totp(&pool, user_id, &row.secret_enc, step as i64, &hashes)
        .await
        .map_err(internal)?
    {
        return Err(no_setup().into());
    }
    sf_throttle.record_success(&profile.email);
    session::delete_others(&pool, user_id, session_id)
        .await
        .map_err(internal)?;
    tracing::info!(user_id = %user_id, "totp enabled");
    Ok(Json(dto::RecoveryCodes {
        recovery_codes: codes,
    }))
}

pub async fn totp_remove(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
    Json(body): Json<dto::ReauthTokenReq>,
) -> Result<StatusCode, ApiError> {
    require_reauth(&pool, user_id, &body.reauth).await?;
    if !mfa::delete_totp(&pool, user_id).await.map_err(internal)? {
        return Err((StatusCode::NOT_FOUND, "no authenticator set up".to_string()));
    }
    session::delete_others(&pool, user_id, session_id)
        .await
        .map_err(internal)?;
    tracing::info!(user_id = %user_id, "totp removed");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn recovery_regenerate(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
    Json(body): Json<dto::ReauthTokenReq>,
) -> Result<Json<dto::RecoveryCodes>, ApiError> {
    require_reauth(&pool, user_id, &body.reauth).await?;
    if !mfa::status(&pool, user_id).await.map_err(internal)?.totp {
        return Err((StatusCode::CONFLICT, "no authenticator set up".to_string()));
    }
    let codes = factors::new_recovery_codes();
    let hashes: Vec<Vec<u8>> = codes
        .iter()
        .map(|c| factors::hash_recovery_code(c))
        .collect();
    mfa::replace_recovery_codes(&pool, user_id, &hashes)
        .await
        .map_err(internal)?;
    session::delete_others(&pool, user_id, session_id)
        .await
        .map_err(internal)?;
    tracing::info!(user_id = %user_id, "recovery codes regenerated");
    Ok(Json(dto::RecoveryCodes {
        recovery_codes: codes,
    }))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::auth::{self, AuthUser};
    use crate::factors;
    use crate::handlers::LoginError;
    use crate::testkit::{seed_session, seed_user, sessions, who};
    use crate::throttle::{LoginThrottle, SecondFactorThrottle};
    use axum::Json;
    use axum::extract::State;
    use axum::http::StatusCode;
    use gripsou_core::repo::{login_challenge, mfa as repo};
    use sqlx::PgPool;
    use std::sync::Arc;
    use uuid::Uuid;

    const KEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn key() -> crate::TotpKey {
        crate::TotpKey(Arc::from(KEY))
    }

    async fn setup(
        pool: &PgPool,
        a: &AuthUser,
    ) -> Result<Json<dto::TotpSetup>, (StatusCode, String)> {
        let token = reauth_token(pool, a, "hunter22").await;
        setup_with(pool, a, &token).await
    }

    async fn setup_with(
        pool: &PgPool,
        a: &AuthUser,
        token: &str,
    ) -> Result<Json<dto::TotpSetup>, (StatusCode, String)> {
        totp_setup(
            State(pool.clone()),
            State(key()),
            who(a),
            Json(dto::ReauthTokenReq {
                reauth: token.into(),
            }),
        )
        .await
    }

    async fn stored_secret(pool: &PgPool, user_id: Uuid) -> Vec<u8> {
        let row = repo::totp(pool, user_id).await.unwrap().unwrap();
        gripsou_core::crypto::decrypt(KEY, &row.secret_enc).unwrap()
    }

    fn code_now(secret: &[u8]) -> String {
        let now = chrono::Utc::now().timestamp() as u64;
        factors::totp_code(secret, factors::current_step(now))
    }

    async fn confirm(
        pool: &PgPool,
        a: &AuthUser,
        code: String,
    ) -> Result<Json<dto::RecoveryCodes>, (StatusCode, String)> {
        confirm_with(pool, a, code, &Arc::new(SecondFactorThrottle::default()))
            .await
            .map_err(|e| (e.0, e.1))
    }

    async fn confirm_with(
        pool: &PgPool,
        a: &AuthUser,
        code: String,
        throttle: &Arc<SecondFactorThrottle>,
    ) -> Result<Json<dto::RecoveryCodes>, LoginError> {
        totp_confirm(
            State(pool.clone()),
            State(key()),
            State(throttle.clone()),
            who(a),
            Json(dto::TotpConfirmReq { code }),
        )
        .await
    }

    fn wrong_code(secret: &[u8]) -> String {
        if code_now(secret) == "000000" {
            "000001".into()
        } else {
            "000000".into()
        }
    }

    async fn reauth_valid(pool: &PgPool, token: &str) -> bool {
        login_challenge::find_valid(pool, &auth::hash_token(token), "reauth")
            .await
            .unwrap()
            .is_some()
    }

    /// Set up and confirm; returns the secret and the recovery codes.
    async fn enrol(pool: &PgPool, a: &AuthUser) -> (Vec<u8>, Vec<String>) {
        let _ = setup(pool, a).await.unwrap();
        let secret = stored_secret(pool, a.user_id).await;
        let codes = confirm(pool, a, code_now(&secret))
            .await
            .unwrap()
            .0
            .recovery_codes;
        (secret, codes)
    }

    pub(crate) async fn reauth_token(pool: &PgPool, a: &AuthUser, password: &str) -> String {
        let throttle = Arc::new(LoginThrottle::default());
        try_reauth(pool, &throttle, a, password)
            .await
            .map_err(|e| (e.0, e.1))
            .unwrap()
            .0
            .reauth
    }

    async fn try_reauth(
        pool: &PgPool,
        throttle: &Arc<LoginThrottle>,
        a: &AuthUser,
        password: &str,
    ) -> Result<Json<dto::ReauthResponse>, LoginError> {
        reauth(
            State(pool.clone()),
            State(throttle.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            who(a),
            Json(dto::ReauthReq {
                password: password.into(),
            }),
        )
        .await
    }

    async fn remove(
        pool: &PgPool,
        a: &AuthUser,
        token: &str,
    ) -> Result<StatusCode, (StatusCode, String)> {
        totp_remove(
            State(pool.clone()),
            who(a),
            Json(dto::ReauthTokenReq {
                reauth: token.into(),
            }),
        )
        .await
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn setup_then_confirm_enables_totp_and_drops_other_sessions(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let _other = seed_session(&pool, uid).await;
        let setup = setup(&pool, &me).await.unwrap().0;
        assert!(setup.qr_svg.contains("<svg"));
        let secret = stored_secret(&pool, uid).await;
        assert_eq!(setup.secret, factors::base32_secret(&secret));
        let codes = confirm(&pool, &me, code_now(&secret))
            .await
            .unwrap()
            .0
            .recovery_codes;
        assert_eq!(codes.len(), 10);
        let st = status(State(pool.clone()), who(&me)).await.unwrap().0;
        assert!(st.totp);
        assert_eq!(st.recovery_remaining, 10);
        assert_eq!(sessions(&pool, uid).await, 1);
        let left: Uuid = sqlx::query_scalar("select id from session where user_id = $1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, me.session_id);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_second_setup_replaces_the_first_secret(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let _ = setup(&pool, &me).await.unwrap();
        let first = stored_secret(&pool, uid).await;
        let _ = setup(&pool, &me).await.unwrap();
        let second = stored_secret(&pool, uid).await;
        assert_ne!(first, second);
        let err = confirm(&pool, &me, code_now(&first)).await.unwrap_err();
        assert_eq!(err, (StatusCode::BAD_REQUEST, "invalid code".to_string()));
        assert!(confirm(&pool, &me, code_now(&second)).await.is_ok());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn setup_needs_a_fresh_reauth_of_the_caller(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let other_uid = seed_user(&pool, "b@t.local").await;
        let me = seed_session(&pool, uid).await;
        let other = seed_session(&pool, other_uid).await;
        for bad in ["", "random-token"] {
            let err = setup_with(&pool, &me, bad).await.unwrap_err();
            assert_eq!(
                err,
                (
                    StatusCode::UNAUTHORIZED,
                    "reauthentication required".to_string()
                )
            );
        }
        let theirs = reauth_token(&pool, &other, "hunter22").await;
        assert_eq!(
            setup_with(&pool, &me, &theirs).await.unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
        assert!(repo::totp(&pool, uid).await.unwrap().is_none());
        // Single use.
        let tok = reauth_token(&pool, &me, "hunter22").await;
        assert!(setup_with(&pool, &me, &tok).await.is_ok());
        assert_eq!(
            setup_with(&pool, &me, &tok).await.unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn removal_with_only_a_pending_setup_is_not_found_and_keeps_sessions(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let _other = seed_session(&pool, uid).await;
        let _ = setup(&pool, &me).await.unwrap();
        let tok = reauth_token(&pool, &me, "hunter22").await;
        assert_eq!(
            remove(&pool, &me, &tok).await.unwrap_err().0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(sessions(&pool, uid).await, 2);
        // The pending setup is discarded.
        assert!(repo::totp(&pool, uid).await.unwrap().is_none());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn setup_after_confirm_is_a_conflict_and_keeps_the_token(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        enrol(&pool, &me).await;
        let token = reauth_token(&pool, &me, "hunter22").await;
        let err = setup_with(&pool, &me, &token).await.unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);
        assert_eq!(err.1, "authenticator already set up");
        assert!(reauth_valid(&pool, &token).await);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn wrong_confirm_codes_are_throttled_and_a_right_one_clears(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let throttle = Arc::new(SecondFactorThrottle::default());
        let _ = setup(&pool, &me).await.unwrap();
        let secret = stored_secret(&pool, uid).await;
        for _ in 0..4 {
            let err = confirm_with(&pool, &me, wrong_code(&secret), &throttle)
                .await
                .unwrap_err();
            assert_eq!(err.0, StatusCode::BAD_REQUEST);
        }
        // A right code clears the four failures.
        let _ = confirm_with(&pool, &me, code_now(&secret), &throttle)
            .await
            .unwrap();
        throttle
            .try_attempt("a@t.local", std::time::Instant::now())
            .expect("cleared");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn the_sixth_confirm_attempt_waits(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let throttle = Arc::new(SecondFactorThrottle::default());
        let _ = setup(&pool, &me).await.unwrap();
        let secret = stored_secret(&pool, uid).await;
        for _ in 0..5 {
            let err = confirm_with(&pool, &me, wrong_code(&secret), &throttle)
                .await
                .unwrap_err();
            assert_eq!(err.0, StatusCode::BAD_REQUEST);
        }
        // Even the right code is refused during the wait.
        let err = confirm_with(&pool, &me, code_now(&secret), &throttle)
            .await
            .unwrap_err();
        assert_eq!(err.0, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(err.2, Some(60));
        assert!(!repo::status(&pool, uid).await.unwrap().totp);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn an_abandoned_setup_cannot_be_confirmed(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let _ = setup(&pool, &me).await.unwrap();
        let secret = stored_secret(&pool, uid).await;
        sqlx::query(
            "update user_totp set created_at = now() - interval '11 minutes' \
             where user_id = $1",
        )
        .bind(uid)
        .execute(&pool)
        .await
        .unwrap();
        let err = confirm(&pool, &me, code_now(&secret)).await.unwrap_err();
        assert_eq!(
            err,
            (StatusCode::CONFLICT, "no setup in progress".to_string())
        );
        assert!(!repo::status(&pool, uid).await.unwrap().totp);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn confirm_with_a_wrong_code_or_no_setup_fails(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let err = confirm(&pool, &me, "123456".into()).await.unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);
        let _ = setup(&pool, &me).await.unwrap();
        let secret = stored_secret(&pool, uid).await;
        let err = confirm(&pool, &me, wrong_code(&secret)).await.unwrap_err();
        assert_eq!(err, (StatusCode::BAD_REQUEST, "invalid code".to_string()));
        assert!(!repo::status(&pool, uid).await.unwrap().totp);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn removal_needs_a_fresh_reauth_of_the_caller(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let other_uid = seed_user(&pool, "b@t.local").await;
        let me = seed_session(&pool, uid).await;
        let other = seed_session(&pool, other_uid).await;
        enrol(&pool, &me).await;
        let _s = seed_session(&pool, uid).await;

        for bad in ["", "random-token"] {
            let err = remove(&pool, &me, bad).await.unwrap_err();
            assert_eq!(
                err,
                (
                    StatusCode::UNAUTHORIZED,
                    "reauthentication required".to_string()
                )
            );
        }
        let theirs = reauth_token(&pool, &other, "hunter22").await;
        assert_eq!(
            remove(&pool, &me, &theirs).await.unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
        // Refused, and burnt.
        assert!(
            login_challenge::find_valid(&pool, &auth::hash_token(&theirs), "reauth")
                .await
                .unwrap()
                .is_none()
        );
        assert!(repo::status(&pool, uid).await.unwrap().totp);

        let fresh = reauth_token(&pool, &me, "hunter22").await;
        assert_eq!(
            remove(&pool, &me, &fresh).await.unwrap(),
            StatusCode::NO_CONTENT
        );
        let st = repo::status(&pool, uid).await.unwrap();
        assert!(!st.totp);
        assert_eq!(st.recovery_remaining, 0);
        assert_eq!(sessions(&pool, uid).await, 1);
        assert_eq!(
            remove(&pool, &me, &fresh).await.unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn removal_without_totp_is_not_found(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let tok = reauth_token(&pool, &me, "hunter22").await;
        assert_eq!(
            remove(&pool, &me, &tok).await.unwrap_err().0,
            StatusCode::NOT_FOUND
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn reauth_wrong_password_is_400_and_throttled(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let throttle = Arc::new(LoginThrottle::default());
        for _ in 0..5 {
            let err = try_reauth(&pool, &throttle, &me, "wrong")
                .await
                .unwrap_err();
            assert_eq!(err.0, StatusCode::BAD_REQUEST);
            assert_eq!(err.1, "password is incorrect");
        }
        let err = try_reauth(&pool, &throttle, &me, "hunter22")
            .await
            .unwrap_err();
        assert_eq!(err.0, StatusCode::TOO_MANY_REQUESTS);
        assert!(err.2.is_some());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn regenerate_replaces_the_codes(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let (_, old) = enrol(&pool, &me).await;
        let _s = seed_session(&pool, uid).await;
        let tok = reauth_token(&pool, &me, "hunter22").await;
        let new = recovery_regenerate(
            State(pool.clone()),
            who(&me),
            Json(dto::ReauthTokenReq {
                reauth: tok.clone(),
            }),
        )
        .await
        .unwrap()
        .0
        .recovery_codes;
        assert_eq!(new.len(), 10);
        assert_eq!(sessions(&pool, uid).await, 1);
        for c in &old {
            assert!(
                repo::use_recovery_code(
                    &mut pool.acquire().await.unwrap(),
                    uid,
                    &factors::hash_recovery_code(c)
                )
                .await
                .unwrap()
                .is_none()
            );
        }
        assert!(
            repo::use_recovery_code(
                &mut pool.acquire().await.unwrap(),
                uid,
                &factors::hash_recovery_code(&new[0])
            )
            .await
            .unwrap()
            .is_some()
        );
        // The token was single use.
        let err = recovery_regenerate(
            State(pool.clone()),
            who(&me),
            Json(dto::ReauthTokenReq { reauth: tok }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn regenerate_needs_a_confirmed_totp(pool: PgPool) {
        let uid = seed_user(&pool, "a@t.local").await;
        let me = seed_session(&pool, uid).await;
        let tok = reauth_token(&pool, &me, "hunter22").await;
        let err = recovery_regenerate(
            State(pool.clone()),
            who(&me),
            Json(dto::ReauthTokenReq { reauth: tok }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn status_is_scoped_to_the_caller(pool: PgPool) {
        let a = seed_user(&pool, "a@t.local").await;
        let b = seed_user(&pool, "b@t.local").await;
        let sa = seed_session(&pool, a).await;
        let sb = seed_session(&pool, b).await;
        enrol(&pool, &sa).await;
        let st_a = status(State(pool.clone()), who(&sa)).await.unwrap().0;
        let st_b = status(State(pool.clone()), who(&sb)).await.unwrap().0;
        assert!(st_a.totp);
        assert_eq!(st_a.recovery_remaining, 10);
        assert!(!st_b.totp);
        assert_eq!(st_b.recovery_remaining, 0);
    }
}
