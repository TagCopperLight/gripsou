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

    if env::args().nth(1).as_deref() == Some("reset-2fa") {
        let code = reset_two_factor(&db, env::args().nth(2)).await;
        log_handle.shutdown().await;
        std::process::exit(code);
    }

    tokio::spawn(gripsou_jobs::run_scheduler(db.clone()));

    let initial_cors = gripsou_core::repo::settings::cors_origins(&db)
        .await
        .unwrap_or_default();
    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into());
    let app = gripsou_api::router(db.clone(), std::path::Path::new(&static_dir), initial_cors);
    // Hash the dummy password now so the first login isn't slower.
    std::sync::LazyLock::force(&gripsou_api::auth::DUMMY_HASH);

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

/// `gripsou reset-2fa <email>`: turn off every second factor of that user and
/// sign them out everywhere. Returns the process exit code.
async fn reset_two_factor(db: &sqlx::PgPool, email: Option<String>) -> i32 {
    let Some(email) = email else {
        eprintln!("usage: gripsou reset-2fa <email>");
        return 2;
    };
    let user = match gripsou_core::repo::user::credentials_by_email(db, &email).await {
        Ok(user) => user,
        Err(e) => {
            tracing::error!(error = %gripsou_core::logs::error_chain(&e), "second factor reset failed");
            eprintln!("could not look up the user");
            return 1;
        }
    };
    let Some(user) = user else {
        eprintln!("no user with that email");
        return 1;
    };
    match gripsou_core::repo::mfa::reset_for_email(db, &email).await {
        Ok(Some((cleared, sessions))) => {
            tracing::info!(user_id = %user.id, reason = "cli", "second factors cleared");
            println!(
                "removed: authenticator {}, backup codes {}, passkeys {}, sessions {}",
                cleared.totp, cleared.recovery_codes, cleared.passkeys, sessions
            );
            0
        }
        Ok(None) => {
            eprintln!("no user with that email");
            1
        }
        Err(e) => {
            tracing::error!(error = %gripsou_core::logs::error_chain(&e), "second factor reset failed");
            eprintln!("could not reset the second factors");
            1
        }
    }
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
