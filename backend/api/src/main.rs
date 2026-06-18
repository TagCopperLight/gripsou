mod auth;
mod dto;
mod handlers;

use std::env;

use axum::{
    Json, Router,
    routing::{delete, get, patch, post},
};
use serde_json::{Value, json};
use tower_http::services::ServeDir;
use tracing_subscriber::EnvFilter;

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

    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into());

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
        .route(
            "/providers/{key}",
            patch(handlers::set_provider),
        )
        .route("/providers/enabled", get(handlers::enabled_providers))
        .route("/connections/init", post(handlers::init_connection))
        .route("/connections/complete", post(handlers::complete_connection))
        .route("/connections/{id}", delete(handlers::delete_connection))
        .route("/holdings", get(handlers::holdings))
        .route("/holdings/{id}/prices", get(handlers::holding_prices))
        .route(
            "/holdings/{id}/transactions",
            get(handlers::holding_transactions),
        )
        .with_state(db.clone());

    let app = Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(static_dir));

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
