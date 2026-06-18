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

/// Resolve the caller and require the admin role. Server config and provider
/// management are admin-only (see ARCHITECTURE: app_settings is admin-tunable).
async fn require_admin(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<(), (StatusCode, String)> {
    let profile = gripsou_core::repo::user::profile_by_id(pool, user_id)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "unauthorized".to_string()))?;
    if profile.role != "admin" {
        return Err((StatusCode::FORBIDDEN, "admin access required".to_string()));
    }
    Ok(())
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

pub async fn connections(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::ProviderGroup>>, (StatusCode, String)> {
    let conns = gripsou_core::repo::connection::list_connections(&pool, user_id)
        .await
        .map_err(internal)?;
    let accounts = gripsou_core::repo::connection::list_connection_accounts(&pool, user_id)
        .await
        .map_err(internal)?;
    Ok(Json(dto::ProviderGroup::tree(conns, accounts)))
}

pub async fn sync_connection(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<dto::ConnectionState>), (StatusCode, String)> {
    use gripsou_core::repo::connection::BeginSync;
    match gripsou_core::repo::connection::begin_sync(&pool, user_id, id)
        .await
        .map_err(internal)?
    {
        BeginSync::Started(state) => {
            // Fire-and-forget: the frontend polls connection status for progress.
            tokio::spawn(gripsou_jobs::sync_connection(pool.clone(), id));
            Ok((
                StatusCode::ACCEPTED,
                Json(dto::ConnectionState::from_row(state)),
            ))
        }
        BeginSync::AlreadySyncing => Err((
            StatusCode::CONFLICT,
            "connection is already syncing".to_string(),
        )),
        BeginSync::NotFound => {
            Err((StatusCode::NOT_FOUND, "connection not found".to_string()))
        }
    }
}

pub async fn sync_all(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, String)> {
    use gripsou_core::repo::connection::BeginSync;
    let ids = gripsou_core::repo::connection::ids_for_user(&pool, user_id)
        .await
        .map_err(internal)?;
    let mut started = 0u32;
    for id in ids {
        if let BeginSync::Started(_) =
            gripsou_core::repo::connection::begin_sync(&pool, user_id, id)
                .await
                .map_err(internal)?
        {
            tokio::spawn(gripsou_jobs::sync_connection(pool.clone(), id));
            started += 1;
        }
    }
    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "started": started })),
    ))
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

pub async fn providers(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::Provider>>, (StatusCode, String)> {
    require_admin(&pool, user_id).await?;
    let rows = gripsou_core::repo::provider::account_providers(&pool)
        .await
        .map_err(internal)?;
    Ok(Json(rows.into_iter().map(dto::Provider::from_row).collect()))
}

pub async fn set_provider(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(key): Path<String>,
    Json(body): Json<dto::SetProviderReq>,
) -> Result<Json<dto::Provider>, (StatusCode, String)> {
    require_admin(&pool, user_id).await?;
    // Reject unknown / non-account providers before mutating.
    let row = gripsou_core::repo::provider::account_provider(&pool, &key)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "provider not found".to_string()))?;
    gripsou_core::repo::provider::set_enabled(&pool, &key, body.enabled)
        .await
        .map_err(internal)?;
    Ok(Json(dto::Provider {
        key: row.key,
        display_name: row.display_name,
        description: row.description,
        enabled: body.enabled,
    }))
}

pub async fn users(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
) -> Result<Json<Vec<dto::User>>, (StatusCode, String)> {
    // Listing every account (names/emails/roles) is admin-only.
    let profile = gripsou_core::repo::user::profile_by_id(&pool, user_id)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "unauthorized".to_string()))?;
    if profile.role != "admin" {
        return Err((StatusCode::FORBIDDEN, "admin access required".to_string()));
    }
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

pub async fn update_prefs(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(prefs): Json<gripsou_core::repo::prefs::UserPrefs>,
) -> Result<Json<dto::SessionUser>, (StatusCode, String)> {
    let profile = gripsou_core::repo::user::update_prefs(&pool, user_id, &prefs)
        .await
        .map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "unauthorized".to_string()))?;
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

pub async fn update_profile(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::UpdateProfileReq>,
) -> Result<Json<dto::SessionUser>, (StatusCode, String)> {
    let name = body.name.trim();
    let email = body.email.trim();
    if name.is_empty() || email.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "name and email are required".to_string(),
        ));
    }
    let profile = gripsou_core::repo::user::update_profile(&pool, user_id, name, email)
        .await
        .map_err(unique_or_internal("email is already in use"))?
        .ok_or((StatusCode::UNAUTHORIZED, "unauthorized".to_string()))?;
    Ok(Json(dto::SessionUser::from_profile(&profile)))
}

/// Map a unique-constraint violation to 409 with `msg`; anything else to 500.
fn unique_or_internal(
    msg: &'static str,
) -> impl Fn(gripsou_core::error::CoreError) -> (StatusCode, String) {
    move |e| match &e {
        gripsou_core::error::CoreError::Db(sqlx::Error::Database(db))
            if db.is_unique_violation() =>
        {
            (StatusCode::CONFLICT, msg.to_string())
        }
        _ => internal(e),
    }
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
    // Refuse to delete the last admin: doing so would lock everyone out of the
    // admin-only settings (user management, server config) for good.
    if profile.role == "admin"
        && gripsou_core::repo::user::count_admins(&pool)
            .await
            .map_err(internal)?
            <= 1
    {
        return Err((
            StatusCode::CONFLICT,
            "cannot delete the last admin".to_string(),
        ));
    }
    gripsou_core::repo::user::delete_user(&pool, user_id)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn enabled_providers(
    State(pool): State<PgPool>,
    _auth: AuthUser,
) -> Result<Json<Vec<dto::EnabledProvider>>, (StatusCode, String)> {
    let rows = gripsou_core::repo::provider::enabled_account_providers(&pool)
        .await
        .map_err(internal)?;
    Ok(Json(
        rows.into_iter().map(dto::EnabledProvider::from_row).collect(),
    ))
}

pub async fn init_connection(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::InitConnectionReq>,
) -> Result<(StatusCode, Json<dto::InitConnectionResp>), (StatusCode, String)> {
    // Validate provider is enabled (also fetches display_name for the row).
    let enabled = gripsou_core::repo::provider::enabled_account_providers(&pool)
        .await
        .map_err(internal)?;
    let provider = enabled
        .iter()
        .find(|p| p.key == body.provider_key)
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                format!("provider '{}' is not enabled", body.provider_key),
            )
        })?;

    match gripsou_jobs::init_connection(
        pool,
        user_id,
        &body.provider_key,
        &provider.display_name,
    )
    .await
    {
        Ok((connection_id, init)) => Ok((
            StatusCode::CREATED,
            Json(dto::InitConnectionResp {
                connection_id: connection_id.to_string(),
                redirect_url: init.redirect_url,
            }),
        )),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

pub async fn complete_connection(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Json(body): Json<dto::CompleteConnectionReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let connection_id = body
        .connection_id
        .parse::<Uuid>()
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid connection_id".to_string()))?;

    match gripsou_jobs::complete_connection(pool, user_id, connection_id, &body.params).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("not found") {
                Err((StatusCode::NOT_FOUND, msg))
            } else {
                Err((StatusCode::BAD_REQUEST, msg))
            }
        }
    }
}

pub async fn delete_connection(
    State(pool): State<PgPool>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let deleted = gripsou_core::repo::connection::delete_connection(&pool, user_id, id)
        .await
        .map_err(internal)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "connection not found".to_string()))
    }
}

#[cfg(test)]
mod auth_tests {
    use super::*;
    use crate::auth;
    use crate::dto::{ChangePasswordReq, LoginReq};
    use sqlx::PgPool;

    async fn seed_user_role(pool: &PgPool, email: &str, password: &str, role: &str) -> Uuid {
        let id = Uuid::new_v4();
        let hash = auth::hash_password(password).unwrap();
        sqlx::query(
            "insert into users (id, email, name, password_hash, role) \
             values ($1, $2, 'Test', $3, $4)",
        )
        .bind(id)
        .bind(email)
        .bind(hash)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
        id
    }

    async fn seed_user(pool: &PgPool, email: &str, password: &str) -> Uuid {
        seed_user_role(pool, email, password, "admin").await
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
        // A non-admin user, so the last-admin guard is not in play here.
        seed_user_role(&pool, "a@t.local", "hunter2", "user").await;
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
    async fn delete_account_refuses_last_admin(pool: PgPool) {
        seed_user_role(&pool, "boss@t.local", "pw", "admin").await;
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

        // Sole admin: deletion is refused even with the correct email.
        let err = delete_account(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                email: "boss@t.local".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);
        assert!(
            gripsou_core::repo::user::profile_by_id(&pool, principal.user_id)
                .await
                .unwrap()
                .is_some()
        );

        // With a second admin present, the first admin can delete itself.
        seed_user_role(&pool, "boss2@t.local", "pw", "admin").await;
        delete_account(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(dto::DeleteAccountReq {
                email: "boss@t.local".into(),
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
    async fn users_endpoint_requires_admin(pool: PgPool) {
        seed_user_role(&pool, "admin@t.local", "pw", "admin").await;
        seed_user_role(&pool, "member@t.local", "pw", "user").await;

        let admin_tok = login_token(&pool, "admin@t.local", "pw").await;
        let admin_sess =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&admin_tok))
                .await
                .unwrap()
                .unwrap();
        let list = users(
            State(pool.clone()),
            auth::AuthUser {
                user_id: admin_sess.user_id,
                session_id: admin_sess.id,
            },
        )
        .await
        .expect("admin can list users");
        assert_eq!(list.0.len(), 2);

        let member_tok = login_token(&pool, "member@t.local", "pw").await;
        let member_sess =
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&member_tok))
                .await
                .unwrap()
                .unwrap();
        let err = users(
            State(pool.clone()),
            auth::AuthUser {
                user_id: member_sess.user_id,
                session_id: member_sess.id,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_profile_persists_and_rejects_duplicate_email(pool: PgPool) {
        seed_user_role(&pool, "a@t.local", "pw", "user").await;
        seed_user_role(&pool, "taken@t.local", "pw", "user").await;
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
        assert_eq!(bad.0, StatusCode::BAD_REQUEST);

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
        assert_eq!(conflict.0, StatusCode::CONFLICT);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn update_prefs_persists_and_me_reflects_it(pool: PgPool) {
        use gripsou_core::repo::prefs::UserPrefs;
        seed_user_role(&pool, "a@t.local", "pw", "user").await;
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

        let next = UserPrefs {
            ui_language: "fr".into(),
            currency_symbol: "$".into(),
            currency_position: "before".into(),
            ..Default::default()
        };

        let updated = update_prefs(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
            Json(next),
        )
        .await
        .expect("update prefs ok");
        assert_eq!(updated.0.prefs.ui_language, "fr");
        assert_eq!(updated.0.prefs.currency_symbol, "$");

        // Persisted: a fresh /auth/me sees the new prefs.
        let me_resp = me(
            State(pool.clone()),
            auth::AuthUser {
                user_id: principal.user_id,
                session_id: principal.session_id,
            },
        )
        .await
        .unwrap();
        assert_eq!(me_resp.0.prefs.currency_position, "before");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn sync_connection_guards_and_orchestrator_errors(pool: PgPool) {
        let user = seed_user_role(&pool, "a@t.local", "pw", "user").await;
        // `powens` provider is seeded by migration 0002 (the FK requires it).
        let conn = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1,$2,'powens','c')",
        )
        .bind(conn)
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();

        let principal =
            || auth::AuthUser { user_id: user, session_id: Uuid::new_v4() };

        // Unknown connection → 404.
        let nf = sync_connection(State(pool.clone()), principal(), Path(Uuid::new_v4()))
            .await
            .unwrap_err();
        assert_eq!(nf.0, StatusCode::NOT_FOUND);

        // Force 'syncing', then a trigger → 409.
        sqlx::query("update connection set status='syncing' where id=$1")
            .bind(conn)
            .execute(&pool)
            .await
            .unwrap();
        let busy = sync_connection(State(pool.clone()), principal(), Path(conn))
            .await
            .unwrap_err();
        assert_eq!(busy.0, StatusCode::CONFLICT);

        // Reset, then run the orchestrator directly (deterministic — no spawn):
        // the stub adapter returns NotImplemented, so status becomes 'error'.
        sqlx::query("update connection set status='ok' where id=$1")
            .bind(conn)
            .execute(&pool)
            .await
            .unwrap();
        gripsou_jobs::sync_connection(pool.clone(), conn).await;
        let (status, err): (String, Option<String>) =
            sqlx::query_as("select status, last_error from connection where id=$1")
                .bind(conn)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "error");
        assert!(err.is_some(), "expected a last_error message");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn connections_returns_provider_tree(pool: PgPool) {
        let user = seed_user_role(&pool, "a@t.local", "pw", "user").await;
        sqlx::query(
            "insert into provider (key, display_name, kind, enabled) \
             values ('powens','Powens','account',true) on conflict (key) do nothing",
        )
        .execute(&pool)
        .await
        .unwrap();
        let conn = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1,$2,'powens','My bank')",
        )
        .bind(conn)
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into account (connection_id, name, currency, type_key) \
             values ($1,'Checking','EUR','checking')",
        )
        .bind(conn)
        .execute(&pool)
        .await
        .unwrap();

        let groups = connections(
            State(pool.clone()),
            auth::AuthUser { user_id: user, session_id: Uuid::new_v4() },
        )
        .await
        .expect("connections ok")
        .0;

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].provider_name, "Powens");
        assert_eq!(groups[0].connections.len(), 1);
        assert_eq!(groups[0].connections[0].display_name, "My bank");
        // Account with no snapshots still appears, valued "0".
        assert_eq!(groups[0].connections[0].accounts.len(), 1);
        assert_eq!(groups[0].connections[0].accounts[0].value, "0");
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

    #[sqlx::test(migrations = "../migrations")]
    async fn providers_lists_account_providers_with_enabled_flag(pool: PgPool) {
        // marketdata is kind='price' and must be excluded; powens is enabled via seed.
        let admin = seed_user_role(&pool, "admin@t.local", "pw", "admin").await;
        let principal = auth::AuthUser { user_id: admin, session_id: Uuid::new_v4() };

        let list = providers(State(pool.clone()), principal).await.expect("ok").0;

        assert_eq!(list.len(), 1, "only account-kind providers are listed");
        assert_eq!(list[0].key, "powens");
        assert_eq!(list[0].display_name, "Powens");
        assert!(list[0].enabled, "powens is in the seeded enabled_providers");
        assert!(list[0].description.is_some());
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn providers_requires_admin(pool: PgPool) {
        let user = seed_user_role(&pool, "user@t.local", "pw", "user").await;
        let err = providers(
            State(pool.clone()),
            auth::AuthUser { user_id: user, session_id: Uuid::new_v4() },
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn set_provider_toggles_enabled_idempotently(pool: PgPool) {
        let admin = seed_user_role(&pool, "admin@t.local", "pw", "admin").await;
        let principal = || auth::AuthUser { user_id: admin, session_id: Uuid::new_v4() };

        // Disable powens (seeded enabled).
        let off = set_provider(
            State(pool.clone()),
            principal(),
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: false }),
        )
        .await
        .expect("disable ok")
        .0;
        assert!(!off.enabled);

        // Idempotent: disabling again still reports disabled and does not error.
        let _ = set_provider(
            State(pool.clone()),
            principal(),
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: false }),
        )
        .await
        .expect("second disable ok");

        // Re-enable.
        let on = set_provider(
            State(pool.clone()),
            principal(),
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: true }),
        )
        .await
        .expect("enable ok")
        .0;
        assert!(on.enabled);

        // Persisted: a fresh list reflects the enabled flag.
        let list = providers(State(pool.clone()), principal()).await.unwrap().0;
        assert!(list.iter().find(|p| p.key == "powens").unwrap().enabled);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn set_provider_unknown_key_is_404(pool: PgPool) {
        let admin = seed_user_role(&pool, "admin@t.local", "pw", "admin").await;
        // 'marketdata' is a price provider, not an account provider → treated as not found.
        for key in ["nope", "marketdata"] {
            let err = set_provider(
                State(pool.clone()),
                auth::AuthUser { user_id: admin, session_id: Uuid::new_v4() },
                Path(key.to_string()),
                Json(dto::SetProviderReq { enabled: true }),
            )
            .await
            .unwrap_err();
            assert_eq!(err.0, StatusCode::NOT_FOUND, "key {key}");
        }
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn set_provider_requires_admin(pool: PgPool) {
        let user = seed_user_role(&pool, "user@t.local", "pw", "user").await;
        let err = set_provider(
            State(pool.clone()),
            auth::AuthUser { user_id: user, session_id: Uuid::new_v4() },
            Path("powens".to_string()),
            Json(dto::SetProviderReq { enabled: false }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn enabled_providers_returns_only_enabled(pool: PgPool) {
        // Seed: powens is enabled via migration 0002; marketdata is price kind.
        let user = seed_user_role(&pool, "u@t.local", "pw", "user").await;
        let rows = enabled_providers(
            State(pool.clone()),
            auth::AuthUser { user_id: user, session_id: Uuid::new_v4() },
        )
        .await
        .expect("ok")
        .0;

        // Only account-kind AND in enabled_providers list.
        assert!(rows.iter().all(|p| p.key != "marketdata"),
            "price providers must be excluded");
        // Powens is in enabled_providers per seed — it should appear.
        assert!(rows.iter().any(|p| p.key == "powens"),
            "powens should be in enabled list");
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn init_connection_rejects_unknown_provider(pool: PgPool) {
        let user = seed_user_role(&pool, "u@t.local", "pw", "user").await;
        let err = init_connection(
            State(pool.clone()),
            auth::AuthUser { user_id: user, session_id: Uuid::new_v4() },
            Json(dto::InitConnectionReq { provider_key: "nope".to_string() }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn init_connection_returns_redirect_url(pool: PgPool) {
        let user = seed_user_role(&pool, "u@t.local", "pw", "user").await;
        let resp = init_connection(
            State(pool.clone()),
            auth::AuthUser { user_id: user, session_id: Uuid::new_v4() },
            Json(dto::InitConnectionReq { provider_key: "powens".to_string() }),
        )
        .await
        .unwrap();

        assert_eq!(resp.0, StatusCode::CREATED);
        assert!(resp.1.redirect_url.as_ref().unwrap().starts_with("https://webview.powens.com/en/connect"));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn delete_connection_guards_ownership(pool: PgPool) {
        let owner = seed_user_role(&pool, "owner@t.local", "pw", "user").await;
        let other = seed_user_role(&pool, "other@t.local", "pw", "user").await;

        let conn_id = Uuid::new_v4();
        sqlx::query(
            "insert into connection (id, user_id, provider_key, display_name) \
             values ($1, $2, 'powens', 'c')",
        )
        .bind(conn_id)
        .bind(owner)
        .execute(&pool)
        .await
        .unwrap();

        // Wrong user → 404.
        let err = delete_connection(
            State(pool.clone()),
            auth::AuthUser { user_id: other, session_id: Uuid::new_v4() },
            axum::extract::Path(conn_id),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::NOT_FOUND);

        // Correct user → 204.
        let ok = delete_connection(
            State(pool.clone()),
            auth::AuthUser { user_id: owner, session_id: Uuid::new_v4() },
            axum::extract::Path(conn_id),
        )
        .await
        .expect("delete ok");
        assert_eq!(ok, StatusCode::NO_CONTENT);

        // Connection is gone.
        let count: i64 =
            sqlx::query_scalar("select count(*) from connection where id=$1")
                .bind(conn_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn complete_connection_unknown_id_returns_error(pool: PgPool) {
        let user = seed_user_role(&pool, "u@t.local", "pw", "user").await;
        let err = complete_connection(
            State(pool.clone()),
            auth::AuthUser { user_id: user, session_id: Uuid::new_v4() },
            Json(dto::CompleteConnectionReq {
                connection_id: Uuid::new_v4().to_string(),
                params: std::collections::HashMap::new(),
            }),
        )
        .await
        .unwrap_err();
        // Unknown connection_id → jobs returns "connection not found" → 400
        assert!(err.0 == StatusCode::BAD_REQUEST || err.0 == StatusCode::NOT_FOUND);
    }
}
