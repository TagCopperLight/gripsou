mod auth;
mod dto;
mod handlers;

use std::env;

use axum::http::Method;
use axum::http::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use axum::{
    Json, Router,
    extract::FromRef,
    routing::{delete, get, patch, post},
};
use serde_json::{Value, json};
use std::sync::{Arc, RwLock};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
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
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let database_url =
        env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL must be set"))?;
    let db = gripsou_core::db::connect(&database_url).await?;

    sqlx::migrate!("../migrations").run(&db).await?;
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
        .route("/account-types", get(handlers::account_types))
        .route("/connections", get(handlers::connections))
        .route("/connections/{id}/sync", post(handlers::sync_connection))
        .route("/sync", post(handlers::sync_all))
        .route("/users", get(handlers::users))
        .route("/providers", get(handlers::providers))
        .route("/providers/{key}", patch(handlers::set_provider))
        .route("/providers/enabled", get(handlers::enabled_providers))
        .route(
            "/settings/cors",
            get(handlers::cors_origins).patch(handlers::set_cors_origins),
        )
        .route("/connections/init", post(handlers::init_connection))
        .route("/connections/complete", post(handlers::complete_connection))
        .route("/connections/{id}", delete(handlers::delete_connection))
        .route("/webhooks/{provider}", post(handlers::webhook))
        .route("/holdings", get(handlers::holdings))
        .route("/holdings/{id}/prices", get(handlers::holding_prices))
        .route(
            "/holdings/{id}/transactions",
            get(handlers::holding_transactions),
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

    let app = Router::new()
        .nest("/api", api.layer(cors_layer))
        .fallback_service(ServeDir::new(static_dir).not_found_service(ServeFile::new(index_html)));

    let addr = env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("listening on http://{addr}");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
