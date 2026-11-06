//! Password sign-in with its optional second step.

use crate::error::Json;
use axum::extract::State;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;

use crate::auth::challenge::{self, Mfa};
use crate::auth::client::Client;
use crate::auth::dto;
use crate::auth::throttle::{Account, Throttles};
use crate::auth::{factors, password, session};
use crate::error::ApiError;
use gripsou_core::crypto::EncryptionKey;
use gripsou_core::repo::{mfa, user};

pub async fn login(
    State(pool): State<PgPool>,
    State(throttles): State<Arc<Throttles>>,
    client: Client,
    Json(body): Json<dto::LoginReq>,
) -> Result<Json<dto::LoginOutcome>, ApiError> {
    let unauthorized = || ApiError::InvalidCredentials;
    let user_agent = client.user_agent.as_str();
    let ip = client.ip.as_str();
    // Refused before the email can become a throttle key or a log field.
    if body.email.len() > password::MAX_EMAIL_LEN {
        return Err(unauthorized());
    }
    let creds = user::credentials_by_email(&pool, &body.email).await?;
    let account = creds
        .as_ref()
        .map_or(Account::Email(&body.email), |c| Account::User(c.id));
    // Counted as a failure until the password proves right.
    let attempt = throttles.password(account, ip, Instant::now())?;
    let ok = password::verify_or_dummy(
        &body.password,
        creds.as_ref().map(|c| c.password_hash.as_str()),
    );
    let Some(creds) = creds.filter(|_| ok) else {
        tracing::warn!(email = %body.email, ip, user_agent, "login failed");
        return Err(unauthorized());
    };
    let status = mfa::status(&pool, creds.id).await?;
    if mfa::has_second_factor(&status) {
        // The password alone proves nothing yet: the attempt stays counted
        // until the second factor is right (see `login_verify`).
        drop(attempt);
        let token = challenge::issue(
            &pool,
            Some(creds.id),
            &Mfa {
                remember: body.remember,
            },
        )
        .await?;
        tracing::info!(user_id = %creds.id, ip, "mfa challenge issued");
        return Ok(Json(dto::LoginOutcome::Mfa(dto::MfaRequired {
            mfa_required: true,
            challenge: token,
        })));
    }
    attempt.succeeded();

    let resp = session::issue(&pool, &client, creds.id, body.remember).await?;
    tracing::info!(user_id = %creds.id, ip, user_agent, method = "password", "login succeeded");
    Ok(Json(dto::LoginOutcome::Session(resp)))
}

/// Second login step: a challenge from `login` plus a TOTP or recovery code
/// becomes a session. Wrong codes count on the second-factor limiter (per
/// account, long memory) and on the IP.
pub async fn login_verify(
    State(pool): State<PgPool>,
    State(throttles): State<Arc<Throttles>>,
    State(key): State<EncryptionKey>,
    client: Client,
    Json(body): Json<dto::LoginVerifyReq>,
) -> Result<Json<dto::LoginResponse>, ApiError> {
    let expired = || ApiError::ChallengeExpired;
    let user_agent = client.user_agent.as_str();
    let ip = client.ip.as_str();
    let user_id = challenge::find::<Mfa>(&pool, &body.challenge)
        .await?
        .and_then(|c| c.user_id)
        .ok_or_else(expired)?;
    let attempt = throttles.login_code(user_id, ip, Instant::now())?;

    // The TOTP step is worked out before the transaction (no DB write).
    let totp_step = match (&body.totp, &body.recovery_code) {
        (Some(code), None) => {
            let row = mfa::totp(&pool, user_id).await?.filter(|r| r.confirmed);
            match row {
                Some(row) => factors::check_totp(&key, &row.secret_enc, code)?,
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
    let challenge = challenge::consume::<Mfa>(&mut *tx, &body.challenge)
        .await?
        .ok_or_else(expired)?;
    let method = match (totp_step, &body.recovery_code) {
        (Some(step), _) => mfa::use_totp_step(&mut *tx, user_id, step as i64)
            .await?
            .then_some(("totp", None)),
        (None, Some(code)) => {
            let hash = factors::hash_recovery_code(code);
            mfa::use_recovery_code(&mut tx, user_id, &hash)
                .await?
                .map(|remaining| ("recovery", Some(remaining)))
        }
        (None, None) => None,
    };
    let Some((method, remaining)) = method else {
        drop(tx);
        tracing::warn!(user_id = %user_id, ip, user_agent, step = "second_factor", "login failed");
        return Err(ApiError::bad_request("invalid code"));
    };
    tx.commit().await?;
    if let Some(remaining) = remaining {
        tracing::info!(user_id = %user_id, remaining, "recovery code used");
    }
    attempt.succeeded();
    let resp = session::issue(&pool, &client, user_id, challenge.state.remember).await?;
    tracing::info!(user_id = %user_id, ip, user_agent, method, "login succeeded");
    Ok(Json(resp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admin::create_invite;
    use crate::auth::AdminUser;
    use crate::testkit::*;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use gripsou_core::testkit::encryption_key as test_key;
    use sqlx::PgPool;
    use uuid::Uuid;

    async fn try_login(
        pool: &PgPool,
        throttles: &Arc<Throttles>,
        email: &str,
        pw: &str,
    ) -> Result<Json<dto::LoginOutcome>, ApiError> {
        login_as(pool, throttles, local(), email, pw, false).await
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn sixth_attempt_after_five_failures_is_refused_with_retry_after(pool: PgPool) {
        seed_admin(&pool, "a@t.local").await;
        let throttle = throttles();
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

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_successful_login_clears_earlier_failures(pool: PgPool) {
        seed_admin(&pool, "a@t.local").await;
        let throttle = throttles();
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

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn unknown_emails_are_throttled_like_real_ones(pool: PgPool) {
        let throttle = throttles();
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
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_concurrent_burst_gets_only_the_free_attempts(pool: PgPool) {
        seed_admin(&pool, "a@t.local").await;
        let throttle = throttles();
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
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn an_oversized_email_is_refused_without_counting(pool: PgPool) {
        let throttle = throttles();
        let email = format!("{}@t.local", "a".repeat(292));
        assert_eq!(email.len(), 300);
        for _ in 0..6 {
            let err = try_login(&pool, &throttle, &email, "x").await.unwrap_err();
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(err.message(), "invalid email or password");
        }
        assert_eq!(throttle.tracked_keys(), (0, 0));
    }

    /// The account's password counter follows the account, not the address
    /// typed: changing the email doesn't wipe the failures.
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn an_email_change_keeps_the_failures(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        let throttle = throttles();
        for _ in 0..5 {
            try_login(&pool, &throttle, "a@t.local", "wrong")
                .await
                .unwrap_err();
        }
        gripsou_core::repo::user::update_profile(&pool, uid, "Test", "new@t.local")
            .await
            .unwrap();
        let err = try_login(&pool, &throttle, "new@t.local", "hunter22")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    async fn mfa_challenge(pool: &PgPool, throttles: &Arc<Throttles>, remember: bool) -> String {
        match login_outcome(pool, throttles, "a@t.local", "hunter22", remember).await {
            dto::LoginOutcome::Mfa(m) => m.challenge,
            other => panic!("expected mfa, got {other:?}"),
        }
    }

    async fn verify(
        pool: &PgPool,
        throttles: &Arc<Throttles>,
        challenge: &str,
        totp: Option<String>,
        recovery: Option<String>,
    ) -> Result<Json<dto::LoginResponse>, ApiError> {
        login_verify(
            State(pool.clone()),
            State(throttles.clone()),
            State(test_key()),
            local(),
            Json(dto::LoginVerifyReq {
                challenge: challenge.into(),
                totp,
                recovery_code: recovery,
            }),
        )
        .await
    }

    /// A challenge issued directly: `login` itself counts one attempt.
    async fn issue_mfa(pool: &PgPool, uid: Uuid) -> String {
        challenge::issue(pool, Some(uid), &Mfa { remember: false })
            .await
            .unwrap()
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn login_without_second_factor_gives_a_session(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        let out = login_outcome(&pool, &throttles(), "a@t.local", "hunter22", false).await;
        let dto::LoginOutcome::Session(resp) = out else {
            panic!("expected a session, got {out:?}");
        };
        assert_eq!(resp.user.email, "a@t.local");
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(
                &pool,
                &crate::auth::hash_token(&resp.token)
            )
            .await
            .unwrap()
            .is_some()
        );
        assert_eq!(sessions(&pool, uid).await, 1);
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn login_with_totp_asks_for_a_code_and_makes_no_session(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        enable_totp(&pool, uid).await;
        match login_outcome(&pool, &throttles(), "a@t.local", "hunter22", false).await {
            dto::LoginOutcome::Mfa(m) => {
                assert!(m.mfa_required);
                assert!(!m.challenge.is_empty());
            }
            other => panic!("expected mfa, got {other:?}"),
        }
        assert_eq!(sessions(&pool, uid).await, 0);
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn correct_totp_gives_a_session_that_keeps_remember(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = throttles();
        let ch = mfa_challenge(&pool, &throttle, true).await;
        let resp = verify(&pool, &throttle, &ch, Some(totp_now(&secret)), None)
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
        assert_eq!(sessions(&pool, uid).await, 1);
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_totp_code_works_once(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = throttles();
        let code = totp_now(&secret);
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

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_wrong_code_keeps_the_challenge(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = throttles();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let err = verify(&pool, &throttle, &ch, Some(wrong_totp(&secret)), None)
            .await
            .unwrap_err();
        assert_eq!(
            (err.status(), err.message()),
            (StatusCode::BAD_REQUEST, "invalid code")
        );
        let _ = verify(&pool, &throttle, &ch, Some(totp_now(&secret)), None)
            .await
            .expect("right code on the same challenge");
    }

    /// Once the password is past, a failure names the user, not the email.
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_failed_second_step_is_saved_with_the_user_id(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(1000);
        let uid = seed_admin(&pool, "a@t.local").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = throttles();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let _ = verify(&pool, &throttle, &ch, Some(wrong_totp(&secret)), None).await;
        writer.flush(&pool).await;

        let fields: serde_json::Value = sqlx::query_scalar(
            "select fields from log where message = 'login failed' and fields->>'step' = 'second_factor'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(fields["user_id"], uid.to_string());
        assert!(fields.get("email").is_none());
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn exactly_one_code_kind_is_required(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        enable_totp(&pool, uid).await;
        let throttle = throttles();
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

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_recovery_code_works_once(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        let (_, codes) = enable_totp(&pool, uid).await;
        let throttle = throttles();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let _ = verify(&pool, &throttle, &ch, None, Some(codes[0].clone()))
            .await
            .expect("recovery ok");
        let status = mfa::status(&pool, uid).await.unwrap();
        assert_eq!(status.recovery_remaining, 9);
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let err = verify(&pool, &throttle, &ch, None, Some(codes[0].clone()))
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn unusable_challenges_are_refused(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = throttles();
        let code = totp_now(&secret);

        let err = verify(&pool, &throttle, "nope", Some(code.clone()), None)
            .await
            .unwrap_err();
        assert_eq!(
            (err.status(), err.message()),
            (StatusCode::GONE, "challenge expired")
        );

        let reauth = challenge::issue(&pool, Some(uid), &challenge::Reauth {})
            .await
            .unwrap();
        let err = verify(&pool, &throttle, &reauth, Some(code.clone()), None)
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);

        let ch = mfa_challenge(&pool, &throttle, false).await;
        gripsou_core::testkit::expire(
            &pool,
            "login_challenge",
            "token_hash = $1",
            crate::auth::hash_token(&ch),
        )
        .await;
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

    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn wrong_codes_are_throttled(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        enable_totp(&pool, uid).await;
        let throttle = throttles();
        let ch = issue_mfa(&pool, uid).await;
        for _ in 0..5 {
            let err = verify(&pool, &throttle, &ch, Some("000000".into()), None)
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        }
        let err = verify(&pool, &throttle, &ch, Some("000000".into()), None)
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
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn wrong_codes_wait_on_the_second_factor_limiter(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(1000);
        let uid = seed_admin(&pool, "a@t.local").await;
        let (secret, _) = enable_totp(&pool, uid).await;
        let throttle = throttles();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        for _ in 0..5 {
            let err = verify(&pool, &throttle, &ch, Some(wrong_totp(&secret)), None)
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        }
        for _ in 0..3 {
            let err = verify(&pool, &throttle, &ch, Some(totp_now(&secret)), None)
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
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_lost_challenge_does_not_burn_a_backup_code(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        let (_, codes) = enable_totp(&pool, uid).await;
        let ch = mfa_challenge(&pool, &throttles(), false).await;
        // A parallel request holds the challenge, not yet committed.
        let mut winner = pool.begin().await.unwrap();
        assert!(
            challenge::consume::<Mfa>(&mut *winner, &ch)
                .await
                .unwrap()
                .is_some()
        );
        let loser = {
            let (pool, ch, code) = (pool.clone(), ch.clone(), codes[0].clone());
            tokio::spawn(async move { verify(&pool, &throttles(), &ch, None, Some(code)).await })
        };
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        winner.commit().await.unwrap();
        let err = loser.await.unwrap().unwrap_err();
        assert_eq!(err.status(), StatusCode::GONE);
        let status = mfa::status(&pool, uid).await.unwrap();
        assert_eq!(status.recovery_remaining, 10);
    }

    /// A wrong backup code leaves the challenge usable.
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn a_wrong_backup_code_keeps_the_challenge(pool: PgPool) {
        let uid = seed_admin(&pool, "a@t.local").await;
        let (_, codes) = enable_totp(&pool, uid).await;
        let throttle = throttles();
        let ch = mfa_challenge(&pool, &throttle, false).await;
        let err = verify(&pool, &throttle, &ch, None, Some("nope-nope".into()))
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        let _ = verify(&pool, &throttle, &ch, None, Some(codes[1].clone()))
            .await
            .expect("right code on the same challenge");
    }

    /// Login (ok and failed) and invite creation are logged, and no saved line
    /// carries the password, the attempted password or the invite token.
    #[sqlx::test(migrator = "gripsou_core::testkit::MIGRATOR")]
    async fn account_lines_are_saved_without_secrets(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(1000);

        let password = "correct horse battery staple";
        let admin = seed_user_with_password(&pool, "log@t.local", password, Role::Admin).await;
        login_token(&pool, "log@t.local", password).await;
        let client = Client {
            user_agent: "test-agent/1".into(),
            ..local()
        };
        let failed = login_as(
            &pool,
            &throttles(),
            client,
            "log@t.local",
            "wrong-pass",
            false,
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
