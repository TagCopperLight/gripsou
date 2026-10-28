mod accounts;
mod admin;
pub mod auth;
mod budget;
pub mod cli;
mod connections;
mod dto;
pub mod error;
mod holdings;
mod security_headers;
#[cfg(test)]
mod testkit;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderValue, Response};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef},
    routing::{delete, get, patch, post, put},
};
use serde_json::{Value, json};
use std::sync::Arc;

use crate::auth::{account, invite, login, mfa, passkey};
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeader;
use tower_http::trace::TraceLayer;

pub use auth::passkey::Passkeys;
pub use gripsou_core::crypto::EncryptionKey;

use crate::auth::throttle::{LoginThrottle, SecondFactorThrottle};

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub login_throttle: Arc<LoginThrottle>,
    pub second_factor_throttle: Arc<SecondFactorThrottle>,
    pub jobs: Arc<gripsou_jobs::Deps>,
    pub passkeys: Passkeys,
}

impl FromRef<AppState> for EncryptionKey {
    fn from_ref(state: &AppState) -> EncryptionKey {
        state.jobs.key.clone()
    }
}

impl FromRef<AppState> for Arc<gripsou_jobs::Deps> {
    fn from_ref(state: &AppState) -> Arc<gripsou_jobs::Deps> {
        state.jobs.clone()
    }
}

impl FromRef<AppState> for Passkeys {
    fn from_ref(state: &AppState) -> Passkeys {
        state.passkeys.clone()
    }
}

impl FromRef<AppState> for sqlx::PgPool {
    fn from_ref(state: &AppState) -> sqlx::PgPool {
        state.db.clone()
    }
}

impl FromRef<AppState> for Arc<LoginThrottle> {
    fn from_ref(state: &AppState) -> Arc<LoginThrottle> {
        state.login_throttle.clone()
    }
}

impl FromRef<AppState> for Arc<SecondFactorThrottle> {
    fn from_ref(state: &AppState) -> Arc<SecondFactorThrottle> {
        state.second_factor_throttle.clone()
    }
}

pub fn router(
    db: sqlx::PgPool,
    static_dir: &std::path::Path,
    jobs: Arc<gripsou_jobs::Deps>,
    passkeys: Passkeys,
) -> Router {
    let app_state = AppState {
        db: db.clone(),
        login_throttle: Arc::new(LoginThrottle::default()),
        second_factor_throttle: Arc::new(SecondFactorThrottle::default()),
        jobs,
        passkeys,
    };

    let index_html = static_dir.join("index.html");

    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(login::login))
        .route("/auth/login/verify", post(login::login_verify))
        .route("/auth/passkey/options", post(passkey::sign_in_options))
        .route("/auth/passkey", post(passkey::sign_in))
        .route("/auth/reauth", post(mfa::reauth))
        .route("/auth/mfa/status", get(mfa::status))
        .route("/auth/mfa/totp/setup", post(mfa::totp_setup))
        .route("/auth/mfa/totp/confirm", post(mfa::totp_confirm))
        .route("/auth/mfa/totp", delete(mfa::totp_remove))
        .route(
            "/auth/mfa/recovery/regenerate",
            post(mfa::recovery_regenerate),
        )
        .route(
            "/auth/mfa/passkeys/register/options",
            post(passkey::register_options),
        )
        .route("/auth/mfa/passkeys/register", post(passkey::register))
        .route(
            "/auth/mfa/passkeys/{id}",
            patch(passkey::rename).delete(passkey::remove),
        )
        .route("/auth/me", get(account::me).patch(account::update_profile))
        .route("/auth/logout", post(account::logout))
        .route("/auth/token/{token}", get(invite::token_info))
        .route("/auth/invite/{token}/redeem", post(invite::redeem_invite))
        .route("/auth/reset/{token}/redeem", post(invite::redeem_reset))
        .route("/auth/prefs", patch(account::update_prefs))
        .route("/auth/welcome", post(account::finish_welcome))
        .route("/auth/change-password", post(account::change_password))
        .route("/auth/account", delete(account::delete_account))
        .route(
            "/auth/sessions",
            get(account::list_sessions).delete(account::revoke_other_sessions),
        )
        .route("/auth/sessions/{id}", delete(account::revoke_session))
        .route("/dashboard/net-worth", get(accounts::net_worth))
        .route("/accounts", get(accounts::accounts))
        .route("/accounts/series", get(accounts::account_series))
        .route("/accounts/{id}", patch(accounts::update_account))
        .route("/transactions", get(accounts::transactions))
        .route(
            "/transactions/counts",
            get(budget::transaction_count_summary),
        )
        .route("/transactions/{id}", patch(budget::patch_transaction))
        .route(
            "/transactions/{id}/apply-to-description",
            post(budget::apply_to_description),
        )
        .route("/transactions/bulk", post(budget::bulk_transactions))
        .route(
            "/budget/categories",
            get(budget::list_categories).post(budget::create_category),
        )
        .route("/budget/categories/order", put(budget::reorder_categories))
        .route(
            "/budget/categories/{id}",
            patch(budget::update_category).delete(budget::delete_category),
        )
        .route(
            "/budget/tags",
            get(budget::list_tags).post(budget::create_tag),
        )
        .route("/budget/summary", get(budget::summary))
        .route("/budget/categorize", post(budget::request_categorize))
        .route("/budget/categorize/status", get(budget::categorize_status))
        .route("/budget/review/{id}/accept", post(budget::accept_review))
        .route("/budget/review/{id}/undo", post(budget::undo_review))
        .route("/budget/trend", get(budget::trend_handler))
        .route(
            "/budget/tags/{id}",
            patch(budget::update_tag).delete(budget::delete_tag),
        )
        .route("/account-types", get(accounts::account_types))
        .route("/connections", get(connections::connections))
        .route("/connections/{id}/sync", post(connections::sync_connection))
        .route(
            "/connections/{id}/manage",
            post(connections::manage_connection),
        )
        .route("/sync", post(connections::sync_all))
        .route("/users", get(admin::users))
        .route("/invites", post(admin::create_invite))
        .route("/users/{id}/reset-link", post(admin::create_reset_link))
        .route(
            "/users/{id}",
            delete(admin::delete_user).patch(admin::set_role),
        )
        .route("/providers", get(admin::providers))
        .route("/providers/{key}", patch(admin::set_provider))
        .route("/providers/enabled", get(connections::enabled_providers))
        .route(
            "/settings/budget-ai",
            get(admin::budget_ai_settings).patch(admin::set_budget_ai_settings),
        )
        .route("/settings/budget-ai/usage", get(admin::budget_ai_usage))
        .route(
            "/settings/budget-ai/models/{provider}",
            get(admin::budget_ai_models),
        )
        .route(
            "/settings/budget-ai/prices",
            put(admin::set_budget_ai_prices),
        )
        .route("/connections/init", post(connections::init_connection))
        .route(
            "/connections/complete",
            post(connections::complete_connection),
        )
        .route("/connections/{id}", delete(connections::delete_connection))
        .route(
            "/webhooks/{provider}",
            post(connections::webhook).layer(DefaultBodyLimit::max(32 * 1024 * 1024)),
        )
        .route("/holdings", get(holdings::holdings))
        .route("/investments/returns", get(holdings::investment_returns))
        .route("/holdings/{id}/prices", get(holdings::holding_prices))
        .route(
            "/holdings/{id}/lots",
            get(holdings::holding_lots).put(holdings::save_lots),
        )
        .route("/holdings/{id}/lots/preview", post(holdings::preview_lots))
        .route(
            "/holdings/{id}/lots/suggestions",
            get(holdings::lot_suggestions),
        )
        .with_state(app_state);

    // Per-request span: every line a handler logs carries request_id, method,
    // the route pattern (not the raw path, full of ids) and, once the session is
    // resolved, user_id. 5xx are logged by `ApiError::internal()` with their cause, so the
    // response line itself is debug.
    let trace_layer = TraceLayer::new_for_http()
        .make_span_with(|req: &axum::http::Request<axum::body::Body>| {
            let route = req
                .extensions()
                .get::<axum::extract::MatchedPath>()
                .map(|p| p.as_str().to_string())
                .unwrap_or_else(|| "unmatched".into());
            tracing::info_span!(
                "request",
                request_id = %uuid::Uuid::new_v4(),
                method = %req.method(),
                route = %route,
                user_id = tracing::field::Empty,
            )
        })
        .on_request(())
        .on_failure(())
        .on_response(
            |response: &axum::http::Response<axum::body::Body>,
             latency: std::time::Duration,
             _span: &tracing::Span| {
                tracing::debug!(
                    status = response.status().as_u16(),
                    duration_ms = latency.as_millis() as u64,
                    "response"
                );
            },
        );

    // Vite names every file under /assets after a hash of its content, so a
    // browser may keep one forever: a new build ships new names. Only
    // successes, or a missing file would stay missing for a year.
    let assets = SetResponseHeader::overriding(
        ServeDir::new(static_dir.join("assets")),
        CACHE_CONTROL,
        |res: &Response<_>| {
            res.status()
                .is_success()
                .then(|| HeaderValue::from_static("public, max-age=31536000, immutable"))
        },
    );
    // Compressed here, as nothing in front of the app is assumed to do it:
    // the JavaScript shrinks to about a third.
    let static_files = Router::new()
        .nest_service("/assets", assets)
        .fallback_service(ServeDir::new(static_dir).not_found_service(ServeFile::new(index_html)))
        .layer(CompressionLayer::new());

    Router::new()
        .nest("/api", api.layer(trace_layer))
        .merge(static_files)
        .layer(axum::middleware::from_fn(
            security_headers::security_headers,
        ))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "version": env!("GRIPSOU_VERSION") }))
}
