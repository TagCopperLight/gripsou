mod auth;
mod dto;
mod handlers;

use std::env;

use axum::{
    Json, Router,
    routing::{get, patch, post},
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

    let auth_secret =
        env::var("AUTH_SECRET").map_err(|_| anyhow::anyhow!("AUTH_SECRET must be set"))?;
    auth::init_secret(auth_secret);

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
        .route("/auth/change-password", post(handlers::change_password))
        .route("/dashboard/net-worth", get(handlers::net_worth))
        .route("/dashboard/distribution", get(handlers::distribution))
        .route("/accounts", get(handlers::accounts))
        .route("/accounts/series", get(handlers::account_series))
        .route("/accounts/{id}", patch(handlers::update_account))
        .route("/account-types", get(handlers::account_types))
        .route("/users", get(handlers::users))
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
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
