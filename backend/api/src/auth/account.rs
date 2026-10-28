//! The signed-in user's own account: profile, preferences, password,
//! sessions, logout and deletion.

use axum::Json;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode};
use sqlx::PgPool;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::auth::{self, AuthUser};
use crate::dto;
use crate::error::ApiError;

pub async fn me(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<dto::SessionUser>, ApiError> {
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

/// Mark the post-invite welcome screen finished (or skipped). Idempotent.
pub async fn finish_welcome(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<StatusCode, ApiError> {
    if !gripsou_core::repo::user::finish_welcome(&pool, user_id).await? {
        return Err(ApiError::Unauthorized);
    }
    tracing::info!(user_id = %user_id, "welcome finished");
    Ok(StatusCode::NO_CONTENT)
}

/// Saves only the settings in the body (see `prefs::patch_prefs`), so two
/// settings changed at once never overwrite each other.
///
/// A new currency is only saved once a rate into it is stored: figures are
/// converted at read time, so without one they could only be shown in the
/// pivot. The rate is fetched now rather than at the next sync, and when it
/// can't be had the change is refused and nothing in the body is saved.
pub async fn update_prefs(
    State(pool): State<PgPool>,
    State(jobs): State<std::sync::Arc<gripsou_jobs::Deps>>,
    AuthUser { user_id, .. }: AuthUser,
    Json(patch): Json<serde_json::Map<String, serde_json::Value>>,
) -> Result<Json<dto::SessionUser>, ApiError> {
    use gripsou_core::repo::prefs::{PrefsError, patch_prefs, valid_currency};
    if let Some(currency) = patch.get("currency").and_then(|v| v.as_str())
        && valid_currency(currency)
    {
        let current = gripsou_core::repo::user::profile_by_id(&pool, user_id)
            .await?
            .ok_or(ApiError::Unauthorized)?
            .prefs
            .currency;
        if currency != current && !reporting_rate_ready(&pool, &jobs, user_id, currency).await? {
            return Err(ApiError::BadGateway(format!(
                "no exchange rate into {currency} right now"
            )));
        }
    }
    let was_enabled = match patch_prefs(&pool, user_id, &patch).await {
        Ok(Some(was)) => was,
        Ok(None) => return Err(ApiError::Unauthorized),
        Err(PrefsError::Invalid(msg)) => return Err(ApiError::BadRequest(msg)),
        Err(PrefsError::Core(e)) => return Err(ApiError::internal(e)),
    };
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let enabled = profile.prefs.budget_ai_enabled;
    if enabled != was_enabled {
        tracing::info!(user_id = %user_id, enabled, "ai opt-in changed");
    }
    if enabled && !was_enabled {
        gripsou_jobs::request_categorize(pool.clone(), user_id);
    }
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

/// How long a currency change waits for its rate before giving up.
const RATE_FETCH_LIMIT: std::time::Duration = std::time::Duration::from_secs(10);

/// Fetches the rate into `currency` (see `update_prefs`). A provider failure
/// or a fetch past `RATE_FETCH_LIMIT` reads as "no rate", logged here.
async fn reporting_rate_ready(
    pool: &PgPool,
    jobs: &gripsou_jobs::Deps,
    user_id: Uuid,
    currency: &str,
) -> Result<bool, ApiError> {
    let today = chrono::Utc::now().date_naive();
    let fetch = gripsou_core::price_sync::ensure_fx_rate(pool, &jobs.prices, currency, today);
    let ready = match tokio::time::timeout(RATE_FETCH_LIMIT, fetch).await {
        Ok(ready) => ready?,
        Err(_) => false,
    };
    if ready {
        tracing::info!(user_id = %user_id, currency, "reporting rate ready");
    } else {
        tracing::warn!(user_id = %user_id, currency, "currency change refused: no rate");
    }
    Ok(ready)
}

pub async fn update_profile(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::UpdateProfileReq>,
) -> Result<Json<dto::SessionUser>, ApiError> {
    let name = body.name.trim();
    let email = body.email.trim();
    if name.is_empty() || email.is_empty() {
        return Err(ApiError::bad_request("name and email are required"));
    }
    let profile = gripsou_core::repo::user::update_profile(&pool, user_id, name, email)
        .await
        .map_err(ApiError::conflict_on_unique("email is already in use"))?
        .ok_or(ApiError::Unauthorized)?;
    tracing::info!(user_id = %user_id, "profile changed");
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

pub async fn logout(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
) -> Result<StatusCode, ApiError> {
    gripsou_core::repo::session::delete(&pool, user_id, session_id).await?;
    tracing::info!(user_id = %user_id, "logout");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_sessions(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
) -> Result<Json<Vec<dto::SessionDto>>, ApiError> {
    let rows = gripsou_core::repo::session::list_for_user(&pool, user_id).await?;
    Ok(Json(
        rows.into_iter()
            .map(|s| dto::SessionDto::from_row(s, session_id))
            .collect(),
    ))
}

pub async fn revoke_session(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let deleted = gripsou_core::repo::session::delete(&pool, user_id, id).await?;
    if deleted {
        tracing::info!(user_id = %user_id, session_id = %id, "session revoked");
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("session not found"))
    }
}

pub async fn revoke_other_sessions(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
) -> Result<StatusCode, ApiError> {
    gripsou_core::repo::session::delete_others(&pool, user_id, session_id).await?;
    tracing::info!(user_id = %user_id, "other sessions revoked");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn change_password(
    State(pool): State<PgPool>,
    State(throttle): State<std::sync::Arc<crate::auth::throttle::LoginThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
    Json(body): Json<dto::ChangePasswordReq>,
) -> Result<StatusCode, ApiError> {
    auth::validate_new_password(&body.new_password)?;
    crate::auth::mfa::check_password(
        &pool,
        &throttle,
        &headers,
        peer,
        user_id,
        &body.current_password,
    )
    .await?;
    let new_hash = auth::hash_password(&body.new_password)?;
    gripsou_core::repo::user::update_password(&pool, user_id, &new_hash).await?;
    gripsou_core::repo::session::delete_others(&pool, user_id, session_id).await?;
    tracing::info!(user_id = %user_id, "password changed");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_account(
    State(pool): State<PgPool>,
    State(throttle): State<std::sync::Arc<crate::auth::throttle::LoginThrottle>>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::DeleteAccountReq>,
) -> Result<StatusCode, ApiError> {
    crate::auth::mfa::check_password(&pool, &throttle, &headers, peer, user_id, &body.password)
        .await?;
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    // Refuse to delete the last admin: doing so would lock everyone out of the
    // admin-only settings (user management, server config) for good.
    if profile.role == "admin" && gripsou_core::repo::user::count_admins(&pool).await? <= 1 {
        return Err(ApiError::Conflict("cannot delete the last admin"));
    }
    gripsou_core::repo::user::delete_user(&pool, user_id).await?;
    tracing::info!(user_id = %user_id, "account deleted");
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth;
    use crate::auth::throttle::LoginThrottle;
    use crate::dto::ChangePasswordReq;
    use crate::testkit::*;
    use rust_decimal::Decimal;
    use serde_json::json;
    use sqlx::PgPool;
    use std::sync::Arc;

    #[sqlx::test(migrations = "../migrations")]
    async fn me_returns_profile_and_logout_revokes(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;
        let token = login_token(&pool, "a@t.local", "hunter2").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        let principal = auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };

        let me_resp = me(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
        )
        .await
        .expect("me ok");
        assert_eq!(me_resp.0.email, "a@t.local");

        logout(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
        )
        .await
        .expect("logout ok");
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn lists_marks_current_and_revokes(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "hunter2").await;
        let t1 = login_token(&pool, "a@t.local", "hunter2").await;
        let t2 = login_token(&pool, "a@t.local", "hunter2").await;
        let s1 = gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&t1))
            .await
            .unwrap()
            .unwrap();
        let s2 = gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&t2))
            .await
            .unwrap()
            .unwrap();
        let principal = auth::AuthUser {
            user_id: s1.user_id,
            session_id: s1.id,
        };

        let list = list_sessions(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
        )
        .await
        .unwrap()
        .0;
        assert_eq!(list.len(), 2);
        assert!(
            list.iter()
                .find(|d| d.id == s1.id.to_string())
                .unwrap()
                .current
        );
        assert!(
            !list
                .iter()
                .find(|d| d.id == s2.id.to_string())
                .unwrap()
                .current
        );

        // revoke the other one
        revoke_session(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            axum::extract::Path(s2.id),
        )
        .await
        .unwrap();
        assert_eq!(
            list_sessions(
                State(pool.clone()),
                auth::AuthUser {
                    user_id: principal.user_id,
                    session_id: principal.session_id
                }
            )
            .await
            .unwrap()
            .0
            .len(),
            1
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn change_password_revokes_other_sessions(pool: PgPool) {
        seed_admin(&pool, "a@t.local", "old-pass").await;
        let current = login_token(&pool, "a@t.local", "old-pass").await;
        let other = login_token(&pool, "a@t.local", "old-pass").await;
        let cur =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&current))
                .await
                .unwrap()
                .unwrap();

        change_password(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: cur.user_id,
                session_id: cur.id,
            },
            Json(ChangePasswordReq {
                current_password: "old-pass".into(),
                new_password: "new-pass".into(),
            }),
        )
        .await
        .expect("change ok");

        // other session gone, current still valid
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&other))
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&current))
                .await
                .unwrap()
                .is_some()
        );

        let hash = gripsou_core::repo::user::password_hash(&pool, cur.user_id)
            .await
            .unwrap()
            .unwrap();
        assert!(auth::verify_password("new-pass", &hash));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_account_requires_the_password(pool: PgPool) {
        // A non-admin user, so the last-admin guard is not in play here.
        seed_user_with_password(&pool, "a@t.local", "hunter2", "user").await;
        let token = login_token(&pool, "a@t.local", "hunter2").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        let principal = auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };

        // A wrong password is rejected and the user/session survive.
        let bad = delete_account(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                password: "wrong".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .is_some()
        );

        // The right password deletes the user; the session is gone via FK cascade.
        delete_account(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                password: "hunter2".into(),
            }),
        )
        .await
        .expect("delete ok");
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, principal.user_id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_account_refuses_last_admin(pool: PgPool) {
        seed_user_with_password(&pool, "boss@t.local", "pw", "admin").await;
        let token = login_token(&pool, "boss@t.local", "pw").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        let principal = auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };

        // Sole admin: deletion is refused even with the right password.
        let err = delete_account(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                password: "pw".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::CONFLICT);
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, principal.user_id)
                .await
                .unwrap()
                .is_some()
        );

        // With a second admin present, the first admin can delete itself.
        seed_user_with_password(&pool, "boss2@t.local", "pw", "admin").await;
        delete_account(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                password: "pw".into(),
            }),
        )
        .await
        .expect("delete ok once another admin exists");
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, principal.user_id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_profile_persists_and_rejects_duplicate_email(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        seed_user_with_password(&pool, "taken@t.local", "pw", "user").await;
        let token = login_token(&pool, "a@t.local", "pw").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        let principal = auth::AuthUser {
            user_id: session.user_id,
            session_id: session.id,
        };

        // A successful edit returns the refreshed profile and persists.
        let updated = update_profile(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::UpdateProfileReq {
                name: "  New Name  ".into(),
                email: " new@t.local ".into(),
            }),
        )
        .await
        .expect("update ok");
        assert_eq!(updated.0.name, "New Name");
        assert_eq!(updated.0.email, "new@t.local");
        let me_resp = me(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
        )
        .await
        .unwrap();
        assert_eq!(me_resp.0.email, "new@t.local");

        // Empty fields are rejected.
        let bad = update_profile(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::UpdateProfileReq {
                name: "   ".into(),
                email: "x@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);

        // Colliding with another user's email returns 409.
        let conflict = update_profile(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::UpdateProfileReq {
                name: "New Name".into(),
                email: "taken@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn change_password_requires_correct_current(pool: PgPool) {
        let id = seed_admin(&pool, "a@t.local", "old-pass").await;
        // Need a real session_id for change_password
        let token = login_token(&pool, "a@t.local", "old-pass").await;
        let session =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .unwrap();
        assert_eq!(session.user_id, id);

        let bad = change_password(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            auth::AuthUser {
                user_id: id,
                session_id: session.id,
            },
            Json(ChangePasswordReq {
                current_password: "nope".into(),
                new_password: "new-pass".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn change_password_is_throttled_like_login(pool: PgPool) {
        seed_user_with_password(&pool, "c@t.local", "old-password", "user").await;
        let who = principal_for(&pool, "c@t.local", "old-password").await;
        let throttle = Arc::new(LoginThrottle::default());
        let attempt = |current: &str| {
            change_password(
                State(pool.clone()),
                State(throttle.clone()),
                axum::http::HeaderMap::new(),
                axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
                AuthUser {
                    user_id: who.user_id,
                    session_id: who.session_id,
                },
                Json(dto::ChangePasswordReq {
                    current_password: current.into(),
                    new_password: "new-password".into(),
                }),
            )
        };
        for _ in 0..5 {
            assert_eq!(
                attempt("wrong").await.unwrap_err().status(),
                StatusCode::BAD_REQUEST
            );
        }
        let err = attempt("old-password").await.unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(can_login(&pool, "c@t.local", "old-password").await);
    }

    async fn patch_prefs(
        pool: &PgPool,
        user_id: Uuid,
        patch: serde_json::Value,
    ) -> Result<dto::SessionUser, ApiError> {
        patch_prefs_with_rate(pool, user_id, patch, Some(Decimal::new(92, 2))).await
    }

    /// `rate: None` stands for the rate provider failing.
    async fn patch_prefs_with_rate(
        pool: &PgPool,
        user_id: Uuid,
        patch: serde_json::Value,
        rate: Option<Decimal>,
    ) -> Result<dto::SessionUser, ApiError> {
        let serde_json::Value::Object(patch) = patch else {
            panic!("a patch is an object")
        };
        let mut deps =
            gripsou_jobs::Deps::from_env(gripsou_core::testkit::encryption_key(), "EUR".into());
        deps.prices = vec![Box::new(gripsou_core::testkit::FixedRateProvider { rate })];
        update_prefs(
            State(pool.clone()),
            State(std::sync::Arc::new(deps)),
            auth::AuthUser {
                user_id,
                session_id: Uuid::new_v4(),
            },
            Json(patch),
        )
        .await
        .map(|Json(user)| user)
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_prefs_saves_only_the_settings_sent(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let updated = patch_prefs(
            &pool,
            user_id,
            json!({ "uiLanguage": "fr", "currency": "USD" }),
        )
        .await
        .unwrap();
        assert_eq!(updated.prefs.display.ui_language, "fr");
        assert_eq!(updated.prefs.currency, "USD");

        patch_prefs(&pool, user_id, json!({ "timeZone": "America/Los_Angeles" }))
            .await
            .unwrap();
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(
            (after.display.ui_language.as_str(), after.currency.as_str()),
            ("fr", "USD")
        );
        assert_eq!(after.time_zone, "America/Los_Angeles");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_new_currency_fetches_its_rate_before_saving(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        patch_prefs(&pool, user_id, json!({ "currency": "USD" }))
            .await
            .unwrap();
        let rates: i64 = sqlx::query_scalar(
            "select count(*) from price p join instrument i on i.id = p.instrument_id \
             where i.kind = 'cash' and i.currency = 'USD'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rates, 1);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_currency_with_no_rate_is_refused_and_nothing_saved(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let err = patch_prefs_with_rate(
            &pool,
            user_id,
            json!({ "currency": "USD", "uiLanguage": "fr" }),
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_GATEWAY);
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(after.currency, "EUR");
        assert_ne!(after.display.ui_language, "fr");

        // The pivot needs no rate, so going back to it never depends on one.
        patch_prefs(&pool, user_id, json!({ "currency": "USD" }))
            .await
            .unwrap();
        patch_prefs_with_rate(&pool, user_id, json!({ "currency": "EUR" }), None)
            .await
            .unwrap();
        assert_eq!(prefs_of(&pool, user_id).await.currency, "EUR");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn two_settings_saved_at_once_both_stick(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let (a, b) = tokio::join!(
            patch_prefs(&pool, user_id, json!({ "currency": "USD" })),
            patch_prefs(&pool, user_id, json!({ "numberDecimals": 0 })),
        );
        a.unwrap();
        b.unwrap();
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(
            (after.currency.as_str(), after.display.number_decimals),
            ("USD", 0)
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_prefs_rejects_bad_values_without_writing(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "tz@example.com", "pw", "user").await;
        let before = prefs_of(&pool, user_id).await;
        let big = format!("data:image/webp;base64,{}", "A".repeat(200 * 1024));
        let bad = [
            json!({ "timeZone": "" }),
            json!({ "timeZone": "Europe/NotAPlace" }),
            json!({ "timeZone": "+02:00" }),
            json!({ "timeZone": "posix/Europe/Paris" }),
            json!({ "currency": "usd" }),
            json!({ "currency": "EURO" }),
            json!({ "currency": null }),
            json!({ "budgetAiThreshold": 40 }),
            json!({ "numberDecimals": "two" }),
            json!({ "avatar": "data:text/html,<script>" }),
            json!({ "avatar": big }),
            json!({ "uiLanguage": "fr", "noSuchPref": true }),
        ];
        for patch in bad {
            let label = patch.to_string();
            let result = patch_prefs(&pool, user_id, patch).await;
            assert!(matches!(result, Err(ApiError::BadRequest(_))), "{label}");
        }
        let after = prefs_of(&pool, user_id).await;
        assert_eq!(
            serde_json::to_value(&after).unwrap(),
            serde_json::to_value(&before).unwrap()
        );
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_null_removes_the_avatar(pool: PgPool) {
        let user_id = seed_user_with_password(&pool, "av@example.com", "pw", "user").await;
        patch_prefs(
            &pool,
            user_id,
            json!({ "avatar": "data:image/webp;base64,UklGRg==" }),
        )
        .await
        .unwrap();
        assert!(prefs_of(&pool, user_id).await.display.avatar.is_some());
        patch_prefs(&pool, user_id, json!({ "avatar": null }))
            .await
            .unwrap();
        assert!(prefs_of(&pool, user_id).await.display.avatar.is_none());
    }

    async fn prefs_of(pool: &PgPool, user_id: Uuid) -> gripsou_core::repo::prefs::UserPrefs {
        gripsou_core::repo::user::profile_by_id(pool, user_id)
            .await
            .unwrap()
            .unwrap()
            .prefs
    }

    /// "Sign out everywhere else" keeps the caller's own session alive.
    #[sqlx::test(migrations = "../migrations")]
    async fn revoke_other_sessions_keeps_current(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let current = principal_for(&pool, "a@t.local", "pw").await;
        principal_for(&pool, "a@t.local", "pw").await;
        let session_id = current.session_id;

        let status = revoke_other_sessions(State(pool.clone()), current)
            .await
            .expect("revoke ok");
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(session_alive(&pool, session_id).await);
    }

    /// "Sign out everywhere else" revokes the caller's other sessions.
    #[sqlx::test(migrations = "../migrations")]
    async fn revoke_other_sessions_revokes_the_others(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        let current = principal_for(&pool, "a@t.local", "pw").await;
        let other = principal_for(&pool, "a@t.local", "pw").await;

        revoke_other_sessions(State(pool.clone()), current)
            .await
            .expect("revoke ok");
        assert!(!session_alive(&pool, other.session_id).await);
    }

    /// "Sign out everywhere else" never touches another user's sessions.
    #[sqlx::test(migrations = "../migrations")]
    async fn revoke_other_sessions_spares_other_users(pool: PgPool) {
        seed_user_with_password(&pool, "a@t.local", "pw", "user").await;
        seed_user_with_password(&pool, "b@t.local", "pw", "user").await;
        let a = principal_for(&pool, "a@t.local", "pw").await;
        let b = principal_for(&pool, "b@t.local", "pw").await;

        revoke_other_sessions(State(pool.clone()), a)
            .await
            .expect("revoke ok");
        assert!(session_alive(&pool, b.session_id).await);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn change_password_refuses_a_short_password(pool: PgPool) {
        seed_user_with_password(&pool, "c@t.local", "old-password", "user").await;
        let who = principal_for(&pool, "c@t.local", "old-password").await;
        let err = change_password(
            State(pool.clone()),
            no_throttle(),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            who,
            Json(dto::ChangePasswordReq {
                current_password: "old-password".into(),
                new_password: "short".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert!(can_login(&pool, "c@t.local", "old-password").await);
    }
}
