//! Password sign-in with its optional second step, and the session it issues.

use axum::Json;
use axum::extract::{ConnectInfo, State};
use axum::http::HeaderMap;
use chrono::{Duration, Utc};
use sqlx::PgPool;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::auth::{self};
use crate::dto;
use crate::error::ApiError;

pub(crate) fn user_agent(headers: &HeaderMap) -> &str {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
}

/// Client IP: the last X-Forwarded-For hop, which the nearest proxy wrote
/// (earlier hops come from the client), else the direct peer address.
/// The per-IP login limit relies on it, so the backend must sit behind a
/// proxy that sets the header; Caddy replaces it, others append to it.
pub(crate) fn client_ip(headers: &HeaderMap, peer: SocketAddr) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|xff| xff.rsplit(',').next())
        .map(str::trim)
        .filter(|ip| !ip.is_empty())
        .map_or_else(|| peer.ip().to_string(), str::to_string)
}

const MAX_EMAIL_LEN: usize = 254;

pub async fn login(
    State(pool): State<PgPool>,
    State(throttle): State<std::sync::Arc<crate::auth::throttle::LoginThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<dto::LoginReq>,
) -> Result<Json<dto::LoginOutcome>, ApiError> {
    let unauthorized = || ApiError::InvalidCredentials;
    let user_agent = user_agent(&headers);
    // No real address is longer (RFC 5321). Refused before the email can
    // become a throttle key or a log field.
    if body.email.len() > MAX_EMAIL_LEN {
        return Err(unauthorized());
    }
    let ip = client_ip(&headers, peer);
    let now = std::time::Instant::now();
    // Counts the attempt as a failure until the password proves right.
    if let Err(blocked) = throttle.try_attempt(&body.email, &ip, now) {
        if blocked.first_refusal {
            tracing::warn!(email = %body.email, ip = %ip, reason = blocked.reason.as_str(), "login throttled");
        }
        return Err(blocked.into());
    }
    let creds = gripsou_core::repo::user::credentials_by_email(&pool, &body.email).await?;
    let ok = auth::verify_password_or_dummy(
        &body.password,
        creds.as_ref().map(|c| c.password_hash.as_str()),
    );
    let Some(creds) = creds.filter(|_| ok) else {
        tracing::warn!(email = %body.email, ip = %ip, user_agent, "login failed");
        return Err(unauthorized());
    };
    let status = gripsou_core::repo::mfa::status(&pool, creds.id).await?;
    if gripsou_core::repo::mfa::has_second_factor(&status) {
        // The password alone proves nothing yet: the attempt stays counted
        // until the second factor is right (see `login_verify`).
        let token = auth::generate_token();
        gripsou_core::repo::login_challenge::create(
            &pool,
            &auth::hash_token(&token),
            Some(creds.id),
            "mfa",
            serde_json::json!({ "remember": body.remember }),
        )
        .await?;
        tracing::info!(user_id = %creds.id, ip = %ip, "mfa challenge issued");
        return Ok(Json(dto::LoginOutcome::Mfa(dto::MfaRequired {
            mfa_required: true,
            challenge: token,
        })));
    }
    throttle.record_success(&body.email, &ip);

    let resp = issue_session(&pool, &headers, peer, creds.id, body.remember).await?;
    tracing::info!(user_id = %creds.id, ip = %ip, user_agent, method = "password", "login succeeded");
    Ok(Json(dto::LoginOutcome::Session(resp)))
}

/// Second login step: a challenge from `login` plus a TOTP or recovery code
/// becomes a session. Wrong codes count on the second-factor throttle (per
/// account, long memory) and on the IP.
pub async fn login_verify(
    State(pool): State<PgPool>,
    State(throttle): State<std::sync::Arc<crate::auth::throttle::LoginThrottle>>,
    State(sf_throttle): State<std::sync::Arc<crate::auth::throttle::SecondFactorThrottle>>,
    State(key): State<crate::EncryptionKey>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<dto::LoginVerifyReq>,
) -> Result<Json<dto::LoginResponse>, ApiError> {
    use gripsou_core::repo::{login_challenge, mfa};
    let expired = || ApiError::ChallengeExpired;
    let user_agent = user_agent(&headers);
    let ip = client_ip(&headers, peer);
    let challenge_hash = auth::hash_token(&body.challenge);
    let challenge = login_challenge::find_valid(&pool, &challenge_hash, "mfa")
        .await?
        .ok_or_else(expired)?;
    let user_id = challenge.user_id.ok_or_else(expired)?;
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await?
        .ok_or_else(expired)?;
    if let Err(blocked) =
        sf_throttle.try_login(&throttle, &profile.email, &ip, std::time::Instant::now())
    {
        if blocked.first_refusal {
            tracing::warn!(email = %profile.email, ip = %ip, reason = blocked.reason.as_str(), "login throttled");
        }
        return Err(blocked.into());
    }

    // The TOTP step is worked out before the transaction (no DB write).
    let totp_step = match (&body.totp, &body.recovery_code) {
        (Some(code), None) => {
            let row = mfa::totp(&pool, user_id).await?.filter(|r| r.confirmed);
            match row {
                Some(row) => crate::auth::factors::check_totp(&key, &row.secret_enc, code)?,
                None => None,
            }
        }
        (None, Some(_)) => None,
        _ => {
            return Err(ApiError::bad_request("code required"));
        }
    };

    // Spending the challenge and the code is one transaction: a request that
    // loses the race for the challenge (a parallel one won) rolls back and
    // leaves its code unspent, and a wrong code leaves the challenge usable.
    let mut tx = pool.begin().await?;
    let challenge = login_challenge::consume(&mut *tx, &challenge_hash, "mfa")
        .await?
        .ok_or_else(expired)?;
    let method = match (totp_step, &body.recovery_code) {
        (Some(step), _) => mfa::use_totp_step(&mut *tx, user_id, step as i64)
            .await?
            .then_some(("totp", None)),
        (None, Some(code)) => {
            let hash = crate::auth::factors::hash_recovery_code(code);
            mfa::use_recovery_code(&mut tx, user_id, &hash)
                .await?
                .map(|remaining| ("recovery", Some(remaining)))
        }
        (None, None) => None,
    };
    let Some((method, remaining)) = method else {
        drop(tx);
        tracing::warn!(email = %profile.email, ip = %ip, user_agent, step = "second_factor", "login failed");
        return Err(ApiError::bad_request("invalid code"));
    };
    tx.commit().await?;
    if let Some(remaining) = remaining {
        tracing::info!(user_id = %user_id, remaining, "recovery code used");
    }
    sf_throttle.record_login_success(&throttle, &profile.email, &ip);
    let remember = challenge
        .state
        .get("remember")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let resp = issue_session(&pool, &headers, peer, user_id, remember).await?;
    tracing::info!(user_id = %user_id, ip = %ip, user_agent, method, "login succeeded");
    Ok(Json(resp))
}

/// Issue a session for `user_id` (30 days when remembered, else 1 day) and
/// build the login-shaped response. Shared by login, its second step, the
/// passkey sign-ins and the invite/reset redeem handlers. Logs nothing: each
/// caller words its own line.
pub(crate) async fn issue_session(
    pool: &PgPool,
    headers: &HeaderMap,
    peer: SocketAddr,
    user_id: Uuid,
    remember: bool,
) -> Result<dto::LoginResponse, ApiError> {
    let profile = gripsou_core::repo::user::profile_by_id(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::internal("user vanished"))?;
    let token = auth::generate_token();
    let hash = auth::hash_token(&token);
    let user_agent = Some(user_agent(headers)).filter(|ua| !ua.is_empty());
    let ip = client_ip(headers, peer);
    let ttl = if remember {
        Duration::days(30)
    } else {
        Duration::days(1)
    };
    let expires_at = Utc::now() + ttl;
    gripsou_core::repo::session::create(
        pool,
        user_id,
        &hash,
        user_agent,
        Some(ip.as_str()),
        remember,
        expires_at,
    )
    .await?;
    Ok(dto::LoginResponse {
        token,
        user: dto::SessionUser::from_profile(&profile),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admin::create_invite;
    use crate::auth;
    use crate::auth::AdminUser;
    use crate::auth::throttle::LoginThrottle;
    use crate::dto::LoginReq;
    use crate::testkit::*;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use gripsou_core::testkit::encryption_key as test_key;
    use sqlx::PgPool;
    use std::sync::Arc;

    #[test]
    fn client_ip_takes_the_hop_the_nearest_proxy_wrote() {
        let peer: SocketAddr = "10.0.0.9:443".parse().unwrap();
        let mut h = HeaderMap::new();
        assert_eq!(client_ip(&h, peer), "10.0.0.9");
        h.insert("x-real-ip", "6.6.6.6".parse().unwrap());
        assert_eq!(client_ip(&h, peer), "10.0.0.9");
        h.insert("x-forwarded-for", "6.6.6.6, 203.0.113.7".parse().unwrap());
        assert_eq!(client_ip(&h, peer), "203.0.113.7");
    }

    async fn try_login(
        pool: &PgPool,
        throttle: &Arc<LoginThrottle>,
        email: &str,
        pw: &str,
    ) -> Result<Json<dto::LoginOutcome>, ApiError> {
        login(
            State(pool.clone()),
            State(throttle.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: email.into(),
                password: pw.into(),
                remember: false,
            }),
        )
        .await
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn sixth_attempt_after_five_failures_is_refused_with_retry_after(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter22").await;
        let throttle = Arc::new(LoginThrottle::default());
        for _ in 0..5 {
            let err = try_login(&pool, &throttle, "a@t.local", "wrong")
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
        }
        // Even the right password waits: the check happens before any verify.
        let err = try_login(&pool, &throttle, "a@t.local", "hunter22")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            matches!(err, ApiError::TooMany { retry_after } if (1..=60).contains(&retry_after))
        );
        let resp = err.into_response();
        assert!(resp.headers().contains_key(axum::http::header::RETRY_AFTER));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_successful_login_clears_earlier_failures(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter22").await;
        let throttle = Arc::new(LoginThrottle::default());
        for _ in 0..4 {
            try_login(&pool, &throttle, "a@t.local", "wrong")
                .await
                .unwrap_err();
        }
        let _ = try_login(&pool, &throttle, "a@t.local", "hunter22")
            .await
            .expect("login ok");
        for _ in 0..4 {
            let err = try_login(&pool, &throttle, "a@t.local", "wrong")
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn unknown_emails_are_throttled_like_real_ones(pool: PgPool) {
        let throttle = Arc::new(LoginThrottle::default());
        for _ in 0..5 {
            try_login(&pool, &throttle, "nobody@t.local", "x")
                .await
                .unwrap_err();
        }
        let err = try_login(&pool, &throttle, "nobody@t.local", "x")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    /// A burst sent all at once gets no more guesses than the same requests
    /// sent one by one: each attempt is counted before the password is checked.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_concurrent_burst_gets_only_the_free_attempts(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter22").await;
        let throttle = Arc::new(LoginThrottle::default());
        let mut set = tokio::task::JoinSet::new();
        for _ in 0..10 {
            let (pool, throttle) = (pool.clone(), throttle.clone());
            set.spawn(async move {
                try_login(&pool, &throttle, "a@t.local", "wrong")
                    .await
                    .unwrap_err()
                    .status()
            });
        }
        let statuses = set.join_all().await;
        let count = |s| statuses.iter().filter(|&&x| x == s).count();
        assert_eq!(count(StatusCode::UNAUTHORIZED), 5, "{statuses:?}");
        assert_eq!(count(StatusCode::TOO_MANY_REQUESTS), 5, "{statuses:?}");
    }

    /// An oversized email is refused like a wrong one, before it can become a
    /// throttle key (or a log field).
    #[sqlx::test(migrations = "../migrations")]
    async fn an_oversized_email_is_refused_without_counting(pool: PgPool) {
        let throttle = Arc::new(LoginThrottle::default());
        let email = format!("{}@t.local", "a".repeat(292));
        assert_eq!(email.len(), 300);
        for _ in 0..6 {
            let err = try_login(&pool, &throttle, &email, "x").await.unwrap_err();
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(err.message(), "invalid email or password");
        }
        assert_eq!(throttle.tracked_keys(), (0, 0));
    }

    fn now_code(secret: &[u8]) -> String {
        let now = Utc::now().timestamp() as u64;
        crate::auth::factors::totp_code(secret, crate::auth::factors::current_step(now))
    }

    async fn mfa_challenge(pool: &PgPool, throttle: &Throttles, remember: bool) -> String {
        match login_outcome(pool, throttle, "a@t.local", "hunter22", remember).await {
            dto::LoginOutcome::Mfa(m) => m.challenge,
            other => panic!("expected mfa, got {other:?}"),
        }
    }

    async fn verify(
        pool: &PgPool,
        throttle: &Throttles,
        challenge: &str,
        totp: Option<String>,
        recovery: Option<String>,
    ) -> Result<Json<dto::LoginResponse>, ApiError> {
        login_verify(
            State(pool.clone()),
            State(throttle.pw.clone()),
            State(throttle.sf.clone()),
            State(test_key()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(dto::LoginVerifyReq {
                challenge: challenge.into(),
                totp,
                recovery_code: recovery,
            }),
        )
        .await
    }

    async fn session_count(pool: &PgPool, user_id: Uuid) -> i64 {
        sqlx::query_scalar("select count(*) from session where user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_without_second_factor_gives_a_session(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let throttle = Throttles::default();
        let out = login_outcome(&pool, &throttle, "a@t.local", "hunter22", false).await;
        assert!(matches!(out, dto::LoginOutcome::Session(_)));
        assert_eq!(session_count(&pool, uid).await, 1);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_with_totp_asks_for_a_code_and_makes_no_session(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        match login_outcome(&pool, &throttle, "a@t.local", "hunter22", false).await {
            dto::LoginOutcome::Mfa(m) => {
                assert!(m.mfa_required);
                assert!(!m.challenge.is_empty());
            }
            other => panic!("expected mfa, got {other:?}"),
        }
        assert_eq!(session_count(&pool, uid).await, 0);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn correct_totp_gives_a_session_that_keeps_remember(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, true).await;
        let resp = verify(&pool, &throttle, &ch, Some(now_code(&secret)), None)
            .await
            .expect("verify ok");
        assert_eq!(resp.0.user.email, "a@t.local");
        let remembered: bool =
            sqlx::query_scalar("select remembered from session where user_id = $1")
                .bind(uid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(remembered);
        assert_eq!(session_count(&pool, uid).await, 1);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_totp_code_works_once(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let code = now_code(&secret);
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let _ = verify(&pool, &throttle, &ch, Some(code.clone()), None)
            .await
            .expect("first use");
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let err = verify(&pool, &throttle, &ch, Some(code), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_wrong_code_keeps_the_challenge(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let wrong = if now_code(&secret) == "000000" {
            "000001"
        } else {
            "000000"
        };
        let err = verify(&pool, &throttle, &ch, Some(wrong.into()), None)
            .await
            .unwrap_err();
        assert_eq!(
            (err.status(), err.message()),
            (StatusCode::BAD_REQUEST, "invalid code")
        );
        let _ = verify(&pool, &throttle, &ch, Some(now_code(&secret)), None)
            .await
            .expect("right code on the same challenge");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn exactly_one_code_kind_is_required(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let none = verify(&pool, &throttle, &ch, None, None).await.unwrap_err();
        assert_eq!(
            (none.status(), none.message()),
            (StatusCode::BAD_REQUEST, "code required")
        );
        let both = verify(&pool, &throttle, &ch, Some("1".into()), Some("x".into()))
            .await
            .unwrap_err();
        assert_eq!(both.message(), "code required");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_recovery_code_works_once(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (_, codes) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let _ = verify(&pool, &throttle, &ch, None, Some(codes[0].clone()))
            .await
            .expect("recovery ok");
        let status = gripsou_core::repo::mfa::status(&pool, uid).await.unwrap();
        assert_eq!(status.recovery_remaining, 9);
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let err = verify(&pool, &throttle, &ch, None, Some(codes[0].clone()))
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn unusable_challenges_are_refused(pool: PgPool) {
        use gripsou_core::repo::login_challenge;
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let code = now_code(&secret);

        let err = verify(&pool, &throttle, "nope", Some(code.clone()), None)
            .await
            .unwrap_err();
        assert_eq!(
            (err.status(), err.message()),
            (StatusCode::GONE, "challenge expired")
        );

        login_challenge::create(
            &pool,
            &auth::hash_token("re"),
            Some(uid),
            "reauth",
            serde_json::json!({}),
        )
        .await
        .unwrap();
        let err = verify(&pool, &throttle, "re", Some(code.clone()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);

        let ch = mfa_challenge(&pool, &throttle, false).await;
        sqlx::query("update login_challenge set expires_at = now() - interval '1 minute' where token_hash = $1")
            .bind(auth::hash_token(&ch))
            .execute(&pool)
            .await
            .unwrap();
        let err = verify(&pool, &throttle, &ch, Some(code.clone()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);

        let ch = mfa_challenge(&pool, &throttle, false).await;
        let _ = verify(&pool, &throttle, &ch, Some(code), None)
            .await
            .expect("first use");
        let err = verify(&pool, &throttle, &ch, Some("123456".into()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn wrong_codes_are_throttled(pool: PgPool) {
        use gripsou_core::repo::login_challenge;
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        // Issued directly: `login` itself counts one attempt.
        login_challenge::create(
            &pool,
            &auth::hash_token("ch"),
            Some(uid),
            "mfa",
            serde_json::json!({}),
        )
        .await
        .unwrap();
        for _ in 0..5 {
            let err = verify(&pool, &throttle, "ch", Some("000000".into()), None)
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        }
        let err = verify(&pool, &throttle, "ch", Some("000000".into()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            err.into_response()
                .headers()
                .contains_key(axum::http::header::RETRY_AFTER)
        );
    }

    /// Wrong codes wait on the second-factor limiter (logged once with that
    /// reason), while the password step of the same account is not slowed.
    #[sqlx::test(migrations = "../migrations")]
    async fn wrong_codes_wait_on_the_second_factor_limiter(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(1000);
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let wrong = if now_code(&secret) == "000000" {
            "000001"
        } else {
            "000000"
        };
        for _ in 0..5 {
            let err = verify(&pool, &throttle, &ch, Some(wrong.into()), None)
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        }
        for _ in 0..3 {
            let err = verify(&pool, &throttle, &ch, Some(now_code(&secret)), None)
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
            assert_eq!(err, ApiError::TooMany { retry_after: 60 });
        }
        // The password step still answers (a fresh challenge), not 429.
        let _ = mfa_challenge(&pool, &throttle, false).await;
        writer.flush(&pool).await;
        let reasons: Vec<String> = sqlx::query_scalar(
            "select fields->>'reason' from log where message = 'login throttled'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(reasons, vec!["second_factor".to_string()]);
    }

    /// A request that loses the challenge to a parallel one keeps its backup
    /// code unspent.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_lost_challenge_does_not_burn_a_backup_code(pool: PgPool) {
        use gripsou_core::repo::login_challenge;
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (_, codes) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        // A parallel request holds the challenge, not yet committed.
        let mut winner = pool.begin().await.unwrap();
        assert!(
            login_challenge::consume(&mut *winner, &auth::hash_token(&ch), "mfa")
                .await
                .unwrap()
                .is_some()
        );
        let loser = {
            let (pool, ch, code) = (pool.clone(), ch.clone(), codes[0].clone());
            tokio::spawn(async move {
                verify(&pool, &Throttles::default(), &ch, None, Some(code)).await
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        winner.commit().await.unwrap();
        let err = loser.await.unwrap().unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);
        let status = gripsou_core::repo::mfa::status(&pool, uid).await.unwrap();
        assert_eq!(status.recovery_remaining, 10);
    }

    /// A wrong backup code leaves the challenge usable.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_wrong_backup_code_keeps_the_challenge(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local", "hunter22").await;
        let (_, codes) = enable_totp(&pool, uid).await;
        let throttle = Throttles::default();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let err = verify(&pool, &throttle, &ch, None, Some("nope-nope".into()))
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        let _ = verify(&pool, &throttle, &ch, None, Some(codes[1].clone()))
            .await
            .expect("right code on the same challenge");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_succeeds_with_good_credentials(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;

        let resp = login(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: "a@t.local".into(),
                password: "hunter2".into(),
                remember: true,
            }),
        )
        .await
        .expect("login ok");
        let resp = session_of(resp);
        assert!(!resp.token.is_empty());
        assert_eq!(resp.user.email, "a@t.local");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_rejects_bad_password(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;

        let err = login(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: "a@t.local".into(),
                password: "wrong".into(),
                remember: false,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_creates_findable_session(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;
        let resp = login(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: "a@t.local".into(),
                password: "hunter2".into(),
                remember: false,
            }),
        )
        .await
        .expect("login ok");

        let hash = auth::hash_token(&session_of(resp).token);
        let session = gripsou_core::repo::session::find_valid_by_hash(&pool, &hash)
            .await
            .unwrap();
        assert!(session.is_some());
    }

    /// Login (ok and failed) and invite creation are logged, and no saved line
    /// carries the password, the attempted password or the invite token.
    #[sqlx::test(migrations = "../migrations")]
    async fn account_lines_are_saved_without_secrets(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(1000);

        let password = "correct horse battery staple";
        let admin = seed_admin(&pool, "log@t.local", password).await;
        login_token(&pool, "log@t.local", password).await;
        let mut ua = axum::http::HeaderMap::new();
        ua.insert(
            axum::http::header::USER_AGENT,
            "test-agent/1".parse().unwrap(),
        );
        let failed = login(
            State(pool.clone()),
            no_throttle(),
            ua,
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: "log@t.local".into(),
                password: "wrong-pass".into(),
                remember: false,
            }),
        )
        .await;
        assert!(failed.is_err());
        let (_, Json(invite)) = create_invite(State(pool.clone()), AdminUser { user_id: admin })
            .await
            .unwrap();
        writer.flush(&pool).await;

        let rows: Vec<(String, serde_json::Value)> =
            sqlx::query_as("select message, fields from log")
                .fetch_all(&pool)
                .await
                .unwrap();
        let messages: Vec<&str> = rows.iter().map(|(m, _)| m.as_str()).collect();
        assert!(messages.contains(&"login succeeded"));
        let (_, failed_line) = rows.iter().find(|(m, _)| m == "login failed").unwrap();
        assert_eq!(failed_line["user_agent"], "test-agent/1");
        assert!(messages.contains(&"invite created"));
        let all = serde_json::to_string(&rows).unwrap();
        assert!(!all.contains(password), "password leaked into the log");
        assert!(
            !all.contains("wrong-pass"),
            "attempted password leaked into the log"
        );
        assert!(
            !all.contains(&invite.token),
            "invite token leaked into the log"
        );
    }
}
