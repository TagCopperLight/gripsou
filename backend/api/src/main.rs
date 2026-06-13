mod dto;
mod user;

use std::env;

use axum::{Json, Router, routing::get};
use serde_json::{Value, json};
use tower_http::services::ServeDir;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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

    let api = Router::new().route("/health", get(health));

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
