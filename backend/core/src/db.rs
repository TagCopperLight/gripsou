use sqlx::postgres::{PgPool, PgPoolOptions};

pub type Db = PgPool;

/// Open a pooled connection to Postgres.
pub async fn connect(database_url: &str) -> Result<Db, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
}
