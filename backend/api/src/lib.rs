pub mod auth;
mod budget;
pub mod cli;
mod dto;
mod factors;
mod handlers;
mod mfa;
pub mod passkey;
mod security_headers;
#[cfg(test)]
mod testkit;
pub mod throttle;
use axum::http::header::{ACCEPT, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderValue, Method, Response};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef},
    routing::{delete, get, patch, post, put},
};
use serde_json::{Value, json};
use std::sync::{Arc, RwLock};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeader;
use tower_http::trace::TraceLayer;

pub use passkey::Passkeys;

use crate::throttle::{LoginThrottle, SecondFactorThrottle};

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub cors_origins: Arc<RwLock<Vec<String>>>,
    pub login_throttle: Arc<LoginThrottle>,
    pub second_factor_throttle: Arc<SecondFactorThrottle>,
    pub totp_key: TotpKey,
    pub passkeys: Passkeys,
}

/// `ENCRYPTION_KEY` as the second-factor handlers see it. Always present and
/// valid: the server refuses to start without one (see [`TotpKey::parse`]), so
/// two-factor authentication is always available.
#[derive(Clone)]
pub struct TotpKey(pub Arc<str>);

impl TotpKey {
    /// Check the raw `ENCRYPTION_KEY` value once, at startup. The error says
    /// what is wrong without ever repeating the value.
    pub fn parse(raw: Option<&str>) -> Result<TotpKey, String> {
        match raw {
            None | Some("") => Err(
                "ENCRYPTION_KEY must be set (generate one with `openssl rand -hex 32`)".into(),
            ),
            Some(k) if gripsou_core::crypto::parse_key(k).is_err() => Err(
                "ENCRYPTION_KEY is not a valid key: expected 64 hex characters (`openssl rand -hex 32`)"
                    .into(),
            ),
            Some(k) => Ok(TotpKey(Arc::from(k))),
        }
    }
}

impl FromRef<AppState> for TotpKey {
    fn from_ref(state: &AppState) -> TotpKey {
        state.totp_key.clone()
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

impl FromRef<AppState> for Arc<RwLock<Vec<String>>> {
    fn from_ref(state: &AppState) -> Arc<RwLock<Vec<String>>> {
        state.cors_origins.clone()
    }
}

pub fn router(
    db: sqlx::PgPool,
    static_dir: &std::path::Path,
    initial_cors: Vec<String>,
    totp_key: TotpKey,
    passkeys: Passkeys,
) -> Router {
    let cors_origins = Arc::new(RwLock::new(initial_cors));
    let app_state = AppState {
        db: db.clone(),
        cors_origins: cors_origins.clone(),
        login_throttle: Arc::new(LoginThrottle::default()),
        second_factor_throttle: Arc::new(SecondFactorThrottle::default()),
        totp_key,
        passkeys,
    };

    let index_html = static_dir.join("index.html");

    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(handlers::login))
        .route("/auth/login/verify", post(handlers::login_verify))
        .route(
            "/auth/login/verify/passkey/options",
            post(passkey::verify_options),
        )
        .route("/auth/login/verify/passkey", post(passkey::verify))
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
        .route(
            "/auth/me",
            get(handlers::me).patch(handlers::update_profile),
        )
        .route("/auth/logout", post(handlers::logout))
        .route("/auth/token/{token}", get(handlers::token_info))
        .route("/auth/invite/{token}/redeem", post(handlers::redeem_invite))
        .route("/auth/reset/{token}/redeem", post(handlers::redeem_reset))
        .route("/auth/prefs", patch(handlers::update_prefs))
        .route("/auth/welcome", post(handlers::finish_welcome))
        .route("/auth/change-password", post(handlers::change_password))
        .route("/auth/account", delete(handlers::delete_account))
        .route(
            "/auth/sessions",
            get(handlers::list_sessions).delete(handlers::revoke_other_sessions),
        )
        .route("/auth/sessions/{id}", delete(handlers::revoke_session))
        .route("/dashboard/net-worth", get(handlers::net_worth))
        .route("/dashboard/distribution", get(handlers::distribution))
        .route("/accounts", get(handlers::accounts))
        .route("/accounts/series", get(handlers::account_series))
        .route("/accounts/{id}", patch(handlers::update_account))
        .route("/transactions", get(handlers::transactions))
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
        .route("/account-types", get(handlers::account_types))
        .route("/connections", get(handlers::connections))
        .route("/connections/{id}/sync", post(handlers::sync_connection))
        .route(
            "/connections/{id}/manage",
            post(handlers::manage_connection),
        )
        .route("/sync", post(handlers::sync_all))
        .route("/users", get(handlers::users))
        .route("/invites", post(handlers::create_invite))
        .route("/users/{id}/reset-link", post(handlers::create_reset_link))
        .route("/users/{id}", delete(handlers::delete_user))
        .route("/providers", get(handlers::providers))
        .route("/providers/{key}", patch(handlers::set_provider))
        .route("/providers/enabled", get(handlers::enabled_providers))
        .route(
            "/settings/cors",
            get(handlers::cors_origins).patch(handlers::set_cors_origins),
        )
        .route(
            "/settings/budget-ai",
            get(handlers::budget_ai_settings).patch(handlers::set_budget_ai_settings),
        )
        .route("/settings/budget-ai/usage", get(handlers::budget_ai_usage))
        .route(
            "/settings/budget-ai/models/{provider}",
            get(handlers::budget_ai_models),
        )
        .route(
            "/settings/budget-ai/prices",
            put(handlers::set_budget_ai_prices),
        )
        .route("/connections/init", post(handlers::init_connection))
        .route("/connections/complete", post(handlers::complete_connection))
        .route("/connections/{id}", delete(handlers::delete_connection))
        .route(
            "/webhooks/{provider}",
            post(handlers::webhook).layer(DefaultBodyLimit::max(32 * 1024 * 1024)),
        )
        .route("/holdings", get(handlers::holdings))
        .route("/investments/returns", get(handlers::investment_returns))
        .route("/holdings/{id}/prices", get(handlers::holding_prices))
        .route(
            "/holdings/{id}/lots",
            get(handlers::holding_lots).put(handlers::save_lots),
        )
        .route("/holdings/{id}/lots/preview", post(handlers::preview_lots))
        .route(
            "/holdings/{id}/lots/suggestions",
            get(handlers::lot_suggestions),
        )
        .with_state(app_state);

    let cors_layer = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(
            move |origin: &axum::http::HeaderValue, _| {
                let origin_str = origin.to_str().unwrap_or("");
                if let Ok(origins) = cors_origins.read() {
                    origins.iter().any(|o| o == origin_str)
                } else {
                    false
                }
            },
        ))
        .allow_methods(vec![
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(vec![AUTHORIZATION, CONTENT_TYPE, ACCEPT])
        // So a throttled login on another origin can say how long to wait.
        .expose_headers(vec![axum::http::header::RETRY_AFTER])
        .allow_credentials(true);

    // Per-request span: every line a handler logs carries request_id, method,
    // the route pattern (not the raw path, full of ids) and, once the session is
    // resolved, user_id. 5xx are logged by `internal()` with their cause, so the
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
        .nest("/api", api.layer(cors_layer).layer(trace_layer))
        .merge(static_files)
        .layer(axum::middleware::from_fn(
            security_headers::security_headers,
        ))
}
async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "version": env!("GRIPSOU_VERSION") }))
}

#[cfg(test)]
mod tests {
    use super::TotpKey;

    const GOOD: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    #[test]
    fn a_valid_key_is_kept() {
        assert_eq!(&*TotpKey::parse(Some(GOOD)).unwrap().0, GOOD);
    }

    #[test]
    fn a_missing_or_empty_key_is_refused() {
        for raw in [None, Some("")] {
            let err = TotpKey::parse(raw).err().unwrap();
            assert!(err.contains("must be set"), "{err}");
        }
    }

    #[test]
    fn a_malformed_key_is_refused_without_its_value() {
        let zz = "zz".repeat(32);
        for raw in ["short", "not-a-hex-key-value", &zz, &format!("{GOOD}00")] {
            let err = TotpKey::parse(Some(raw)).err().unwrap();
            assert!(err.contains("not a valid key"), "{err}");
            assert!(!err.contains(raw));
        }
    }
}
