//! Dashboard + auth handlers. State is the PgPool; the authenticated user is
//! resolved per request via the `AuthUser` extractor (bearer token).

use axum::Json;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::Deserialize;
use sqlx::PgPool;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::auth::{self, AuthUser};
use crate::dto;

/// Map a range key to an inclusive [from, to=now] window.
fn range_window(range: &str) -> (DateTime<Utc>, DateTime<Utc>) {
    let now = Utc::now();
    let from = match range {
        "24h" => now - Duration::days(1),
        "7d" => now - Duration::days(7),
        "1mo" => now - Duration::days(30),
        "6mo" => now - Duration::days(182),
        "1y" => now - Duration::days(365),
        "ytd" => NaiveDate::from_ymd_opt(now.year(), 1, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc(),
        _ => now - Duration::days(4000), // "max"
    };
    (from, now)
}

#[derive(Deserialize)]
pub struct RangeParams {
    #[serde(default = "default_range")]
    range: String,
}
fn default_range() -> String {
    "6mo".to_string()
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

/// Client IP, reverse-proxy aware: first X-Forwarded-For hop, then X-Real-IP,
/// then the direct peer address.
fn client_ip(headers: &HeaderMap, peer: SocketAddr) -> String {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        let first = xff.split(',').next().unwrap_or("").trim();
        if !first.is_empty() {
            return first.to_string();
        }
    }
    if let Some(real) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let real = real.trim();
        if !real.is_empty() {
            return real.to_string();
        }
    }
    peer.ip().to_string()
}

pub async fn net_worth(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<dto::NetWorthResponse>, (StatusCode, String)> {
    let (from, to) = range_window(&p.range);
    let rows = gripsou_core::repo::query::net_worth_series(
        &pool,
        user_id,
        from.date_naive(),
        to.date_naive(),
    )
    .await
    .map_err(internal)?;
    Ok(Json(dto::NetWorthResponse::from_rows(&rows)))
}

pub async fn distribution(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::DistributionAccount>>, (StatusCode, String)> {
    let rows = gripsou_core::repo::query::distribution(&pool, user_id)
        .await
        .map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(dto::DistributionAccount::from_row)
            .collect(),
    ))
}

pub async fn holdings(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::Holding>>, (StatusCode, String)> {
    let rows = gripsou_core::repo::query::holdings(&pool, user_id)
        .await
        .map_err(internal)?;
    Ok(Json(rows.into_iter().map(dto::Holding::from_row).collect()))
}

pub async fn holding_prices(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<RangeParams>,
) -> Result<Json<Vec<dto::PricePoint>>, (StatusCode, String)> {
    let (from, to) = range_window(&p.range);
    let rows = gripsou_core::repo::query::holding_prices(&pool, user_id, id, from, to)
        .await
        .map_err(internal)?;
    Ok(Json(
        rows.into_iter().map(dto::PricePoint::from_row).collect(),
    ))
}

pub async fn holding_transactions(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<dto::Purchase>>, (StatusCode, String)> {
    let rows = gripsou_core::repo::query::holding_transactions(&pool, user_id, id)
        .await
        .map_err(internal)?;
    Ok(Json(
        rows.into_iter().map(dto::Purchase::from_row).collect(),
    ))
}

pub async fn accounts(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::Account>>, (StatusCode, String)> {
    let rows = gripsou_core::repo::query::accounts(&pool, user_id)
        .await
        .map_err(internal)?;
    Ok(Json(rows.into_iter().map(dto::Account::from_row).collect()))
}

pub async fn account_series(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Query(p): Query<RangeParams>,
) -> Result<Json<dto::AccountSeriesResponse>, (StatusCode, String)> {
    let (from, to) = range_window(&p.range);
    let rows = gripsou_core::repo::query::account_series(
        &pool,
        user_id,
        from.date_naive(),
        to.date_naive(),
    )
    .await
    .map_err(internal)?;
    Ok(Json(dto::AccountSeriesResponse::from_rows(rows)))
}

pub async fn account_types(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<dto::AccountType>>, (StatusCode, String)> {
    let rows = gripsou_core::repo::query::account_types(&pool)
        .await
        .map_err(internal)?;
    Ok(Json(
        rows.into_iter().map(dto::AccountType::from_row).collect(),
    ))
}

pub async fn update_account(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<dto::UpdateAccountReq>,
) -> Result<Json<dto::UpdatedAccount>, (StatusCode, String)> {
    let updated = gripsou_core::repo::account::update_account(
        &pool,
        user_id,
        id,
        &body.name,
        &body.type_key,
        &body.color,
    )
    .await
    .map_err(internal)?
    .ok_or((StatusCode::NOT_FOUND, "account not found".to_string()))?;
    Ok(Json(dto::UpdatedAccount::from_row(updated)))
}

pub async fn users(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::User>>, (StatusCode, String)> {
    let rows = gripsou_core::repo::query::users(&pool)
        .await
        .map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|r| dto::User::from_row(r, user_id))
            .collect(),
    ))
}

pub async fn login(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<dto::LoginReq>,
) -> Result<Json<dto::LoginResponse>, (StatusCode, String)> {
    let unauthorized = || {
        (
            StatusCode::UNAUTHORIZED,
            "invalid email or password".to_string(),
        )
    };
    let creds = gripsou_core::repo::user::credentials_by_email(&pool, &body.email)
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)?;
    if !auth::verify_password(&body.password, &creds.password_hash) {
        return Err(unauthorized());
    }

    let token = auth::generate_token();
    let hash = auth::hash_token(&token);
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok());
    let ip = client_ip(&headers, peer);
    let ttl = if body.remember {
        Duration::days(30)
    } else {
        Duration::days(1)
    };
    let expires_at = Utc::now() + ttl;
    gripsou_core::repo::session::create(
        &pool,
        creds.id,
        &hash,
        user_agent,
        Some(ip.as_str()),
        body.remember,
        expires_at,
    )
    .await
    .map_err(internal)?;

    Ok(Json(dto::LoginResponse {
        token,
        user: dto::SessionUser::from_credentials(&creds),
    }))
}

pub async fn me(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<dto::SessionUser>, (StatusCode, String)> {
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "unauthorized".to_string()))?;
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

pub async fn logout(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
) -> Result<StatusCode, (StatusCode, String)> {
    gripsou_core::repo::session::delete(&pool, user_id, session_id)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_sessions(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
) -> Result<Json<Vec<dto::SessionDto>>, (StatusCode, String)> {
    let rows = gripsou_core::repo::session::list_for_user(&pool, user_id)
        .await
        .map_err(internal)?;
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
) -> Result<StatusCode, (StatusCode, String)> {
    let deleted = gripsou_core::repo::session::delete(&pool, user_id, id)
        .await
        .map_err(internal)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "session not found".to_string()))
    }
}

pub async fn revoke_other_sessions(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
) -> Result<StatusCode, (StatusCode, String)> {
    gripsou_core::repo::session::delete_others(&pool, user_id, session_id)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn change_password(
    State(pool): State<PgPool>,
    AuthUser {
        user_id,
        session_id,
    }: AuthUser,
    Json(body): Json<dto::ChangePasswordReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let hash = gripsou_core::repo::user::password_hash(&pool, user_id)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "unauthorized".to_string()))?;
    if !auth::verify_password(&body.current_password, &hash) {
        return Err((
            StatusCode::BAD_REQUEST,
            "current password is incorrect".to_string(),
        ));
    }
    let new_hash = auth::hash_password(&body.new_password).map_err(internal)?;
    gripsou_core::repo::user::update_password(&pool, user_id, &new_hash)
        .await
        .map_err(internal)?;
    gripsou_core::repo::session::delete_others(&pool, user_id, session_id)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_account(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::DeleteAccountReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "unauthorized".to_string()))?;
    // Confirm the typed email matches the account being deleted (case-insensitive).
    if body.email.trim().to_lowercase() != profile.email.to_lowercase() {
        return Err((
            StatusCode::BAD_REQUEST,
            "email does not match account".to_string(),
        ));
    }
    gripsou_core::repo::user::delete_user(&pool, user_id)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod auth_tests {
    use super::*;
    use crate::auth;
    use crate::dto::{ChangePasswordReq, LoginReq};
    use sqlx::PgPool;

    async fn seed_user(pool: &PgPool, email: &str, password: &str) -> Uuid {
        let id = Uuid::new_v4();
        let hash = auth::hash_password(password).unwrap();
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, $2, 'Test', $3, 'admin')",
        )
        .bind(id)
        .bind(email)
        .bind(hash)
        .execute(pool)
        .await
        .unwrap();
        id
    }

    async fn login_token(pool: &PgPool, email: &str, pw: &str) -> String {
        login(
            State(pool.clone()),
            axum::http::HeaderMap::new(),
            axum::extract::ConnectInfo("127.0.0.1:0".parse().unwrap()),
            Json(LoginReq {
                email: email.into(),
                password: pw.into(),
                remember: false,
            }),
        )
        .await
        .expect("login ok")
        .0
        .token
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_succeeds_with_good_credentials(pool: PgPool) {
        seed_user(&pool, "a@t.local", "hunter2").await;

        let resp = login(
            State(pool.clone()),
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
        assert!(!resp.0.token.is_empty());
        assert_eq!(resp.0.user.email, "a@t.local");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_rejects_bad_password(pool: PgPool) {
        seed_user(&pool, "a@t.local", "hunter2").await;

        let err = login(
            State(pool.clone()),
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
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn login_creates_findable_session(pool: PgPool) {
        seed_user(&pool, "a@t.local", "hunter2").await;
        let resp = login(
            State(pool.clone()),
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

        let hash = auth::hash_token(&resp.0.token);
        let session = gripsou_core::repo::session::find_valid_by_hash(&pool, &hash)
            .await
            .unwrap();
        assert!(session.is_some());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn me_returns_profile_and_logout_revokes(pool: PgPool) {
        seed_user(&pool, "a@t.local", "hunter2").await;
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
        seed_user(&pool, "a@t.local", "hunter2").await;
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
        seed_user(&pool, "a@t.local", "old-pass").await;
        let current = login_token(&pool, "a@t.local", "old-pass").await;
        let other = login_token(&pool, "a@t.local", "old-pass").await;
        let cur =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&current))
                .await
                .unwrap()
                .unwrap();

        change_password(
            State(pool.clone()),
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
    async fn delete_account_requires_matching_email(pool: PgPool) {
        seed_user(&pool, "a@t.local", "hunter2").await;
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

        // Wrong email is rejected and the user/session survive.
        let bad = delete_account(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                email: "wrong@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(bad.0, StatusCode::BAD_REQUEST);
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&token))
                .await
                .unwrap()
                .is_some()
        );

        // Correct email (case-insensitive) deletes the user; the session is gone
        // via FK cascade.
        delete_account(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                email: "A@T.local".into(),
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
    async fn change_password_requires_correct_current(pool: PgPool) {
        let id = seed_user(&pool, "a@t.local", "old-pass").await;
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
        assert_eq!(bad.0, StatusCode::BAD_REQUEST);
    }
}
