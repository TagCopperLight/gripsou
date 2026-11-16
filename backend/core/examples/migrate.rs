//! Applies the migrations to `DATABASE_URL` and exits (`ci.sh` runs it on `template1`).

use sqlx::PgPool;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url =
        std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL must be set"))?;
    let pool = PgPool::connect(&url).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;
    // Close explicitly: Postgres refuses to copy a template with an open connection.
    pool.close().await;
    Ok(())
}
