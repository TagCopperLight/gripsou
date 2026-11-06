//! Applies the migrations to `DATABASE_URL` and exits. `ci.sh` runs it on its
//! throwaway Postgres's `template1` (the reason is there).
//!
//!     DATABASE_URL=postgres://.../template1 cargo run --example migrate

use sqlx::PgPool;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url =
        std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL must be set"))?;
    let pool = PgPool::connect(&url).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;
    // Close explicitly: Postgres refuses to copy a template that still has a
    // connection open.
    pool.close().await;
    Ok(())
}
