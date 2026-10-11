use crate::error::CoreError;
use sqlx::postgres::{PgPool, PgPoolOptions};
use uuid::Uuid;

pub type Db = PgPool;

/// Open a pooled connection to Postgres.
pub async fn connect(database_url: &str) -> Result<Db, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
}

/// Takes the user's write lock for the rest of the caller's transaction.
///
/// It serialises everything that writes a user's `transaction` rows across
/// accounts: their syncs (ingest and its pairing pass) and their budget edits.
/// Those paths lock rows in different orders (a bulk edit by id, pairing in
/// whatever order its update meets them), so without one lock taken first, an
/// edit overlapping a sync can form a cycle and Postgres aborts one of them.
/// Must be the first statement of the transaction, before any row lock.
/// Transaction-scoped: released on commit or rollback, never stranded.
pub async fn lock_user_writes(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
) -> Result<(), CoreError> {
    sqlx::query!(
        "select pg_advisory_xact_lock(hashtext($1))",
        user_id.to_string()
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}
