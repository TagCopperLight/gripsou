use gripsou_core::crypto::EncryptionKey;
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

    let command = match env::args().nth(1).as_deref() {
        None => Command::Serve(serve_config()?),
        Some("reset-2fa") => Command::ResetTwoFactor(env::args().nth(2)),
        Some(other) => {
            eprintln!("unknown command: {other}\nusage: gripsou [reset-2fa <email>]");
            std::process::exit(2);
        }
    };

    let database_url =
        env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL must be set"))?;
    let db = gripsou_core::db::connect(&database_url).await?;

    sqlx::migrate!("../migrations").run(&db).await?;
    // The log table exists from here; lines queued since startup are written too.
    let log_handle = log_writer.spawn(db.clone());
    tracing::info!("migrations applied");

    let (key, passkeys) = match command {
        Command::Serve(config) => config,
        Command::ResetTwoFactor(email) => {
            let code = gripsou_api::cli::reset_two_factor(&db, email).await;
            log_handle.shutdown().await;
            std::process::exit(code);
        }
    };

    let jobs = gripsou_jobs::Deps::load(&db, key, passkeys.public_url().to_string())
        .await
        .map_err(anyhow::Error::msg)?;
    let jobs = std::sync::Arc::new(jobs);
    tokio::spawn(gripsou_jobs::run_scheduler(db.clone(), jobs.clone()));

    // After the migrations, before listening: the banner sits just above the
    // `listening` line.
    let setup = gripsou_api::setup::start(&db).await?;
    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into());
    let app = gripsou_api::router(
        db.clone(),
        std::path::Path::new(&static_dir),
        jobs,
        passkeys,
        setup,
    );
    // Hash the dummy password now so the first login isn't slower.
    std::sync::LazyLock::force(&gripsou_api::auth::password::DUMMY_HASH);

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

enum Command {
    Serve((EncryptionKey, gripsou_api::Passkeys)),
    ResetTwoFactor(Option<String>),
}

/// What serving needs from the environment, checked before touching the
/// database. The key is never printed.
fn serve_config() -> anyhow::Result<(EncryptionKey, gripsou_api::Passkeys)> {
    let key = EncryptionKey::parse(env::var("ENCRYPTION_KEY").ok().as_deref())
        .map_err(anyhow::Error::msg)?;
    let passkeys = gripsou_api::Passkeys::parse(env::var("PUBLIC_URL").ok().as_deref())
        .map_err(anyhow::Error::msg)?;
    Ok((key, passkeys))
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
