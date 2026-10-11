use std::env;
use tracing_subscriber::EnvFilter;

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
    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into());
    let app = gripsou_api::router(db.clone(), std::path::Path::new(&static_dir), initial_cors);

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
