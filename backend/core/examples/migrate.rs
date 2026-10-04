//! Applies the migrations to `DATABASE_URL` and exits.
//!
//! CI points it at the throwaway Postgres's `template1`: every
//! `#[sqlx::test]` database is copied from there, so each one then starts
//! migrated and its own migrator finds nothing left to apply. Running every
//! migration once instead of once per test saves most of the test step's time.
//!
//!     DATABASE_URL=postgres://.../template1 cargo run --example migrate
//!
//! Don't aim it at a local server you also use for tests while iterating on a
//! new migration: the template would keep the old version's checksum, and every
//! test database copied from it would then refuse the edited file.

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
