mod auth;
mod budget;
mod dto;
mod handlers;

use std::env;

use axum::http::Method;
use axum::http::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef},
    routing::{delete, get, patch, post, put},
};
use serde_json::{Value, json};
use std::sync::{Arc, RwLock};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub cors_origins: Arc<RwLock<Vec<String>>>,
}

impl FromRef<AppState> for sqlx::PgPool {
    fn from_ref(state: &AppState) -> sqlx::PgPool {
        state.db.clone()
    }
}

impl FromRef<AppState> for Arc<RwLock<Vec<String>>> {
    fn from_ref(state: &AppState) -> Arc<RwLock<Vec<String>>> {
        state.cors_origins.clone()
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    // Two independent outputs: the terminal (filtered by RUST_LOG, default info)
    // and the saved log (gripsou's info+ lines, whatever RUST_LOG says).
    let log_writer = gripsou_core::logs::install(
        EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
    );

    let database_url =
        env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL must be set"))?;
    let db = gripsou_core::db::connect(&database_url).await?;

    sqlx::migrate!("../migrations").run(&db).await?;
    // The log table exists from here; lines queued since startup are written too.
    let log_handle = log_writer.spawn(db.clone());
    tracing::info!("migrations applied");
    tokio::spawn(gripsou_jobs::run_scheduler(db.clone()));

    let initial_cors = gripsou_core::repo::settings::cors_origins(&db)
        .await
        .unwrap_or_default();
    let cors_origins = Arc::new(RwLock::new(initial_cors));

    let app_state = AppState {
        db: db.clone(),
        cors_origins: cors_origins.clone(),
    };

    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into());
    let index_html = format!("{static_dir}/index.html");

    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(handlers::login))
        .route(
            "/auth/me",
            get(handlers::me).patch(handlers::update_profile),
        )
        .route("/auth/logout", post(handlers::logout))
        .route("/auth/token/{token}", get(handlers::token_info))
        .route("/auth/invite/{token}/redeem", post(handlers::redeem_invite))
        .route("/auth/reset/{token}/redeem", post(handlers::redeem_reset))
        .route("/auth/prefs", patch(handlers::update_prefs))
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

    let app = Router::new()
        .nest("/api", api.layer(cors_layer).layer(trace_layer))
        .fallback_service(ServeDir::new(static_dir).not_found_service(ServeFile::new(index_html)));

    let addr = env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(addr = %addr, "listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    tracing::info!("server stopped");
    log_handle.shutdown().await;
    Ok(())
}

/// Ctrl-C locally, SIGTERM from `docker stop`.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "version": env!("GRIPSOU_VERSION") }))
}
