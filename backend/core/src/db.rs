use crate::error::CoreError;
use sqlx::postgres::{PgPool, PgPoolOptions};
use uuid::Uuid;

pub type Db = PgPool;

pub async fn connect(database_url: &str) -> Result<Db, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
}

/// A database transaction holding one user's write lock. Only
/// [`lock_user_writes`] makes one, so a function that takes it cannot run
/// without the lock.
///
/// The lock serialises everything that writes a user's `transaction` rows or
/// derived history across accounts: their syncs (ingest and its pairing pass),
/// their budget edits and their lot edits. Those paths lock rows in different
/// orders (a bulk edit by id, pairing in whatever order its update meets
/// them), so without one lock taken first, an edit overlapping a sync can form
/// a cycle and Postgres aborts one of them. Transaction-scoped: released on
/// commit or rollback, never stranded.
pub struct UserWriteTx<'c> {
    tx: sqlx::Transaction<'c, sqlx::Postgres>,
    user_id: Uuid,
}

impl UserWriteTx<'_> {
    /// Whose rows this transaction may write.
    pub fn user_id(&self) -> Uuid {
        self.user_id
    }

    pub async fn commit(self) -> Result<(), CoreError> {
        self.tx.commit().await?;
        Ok(())
    }
}

impl std::ops::Deref for UserWriteTx<'_> {
    type Target = sqlx::PgConnection;
    fn deref(&self) -> &Self::Target {
        &self.tx
    }
}

impl std::ops::DerefMut for UserWriteTx<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.tx
    }
}

/// Takes the user's write lock for the rest of `tx`. Must come before any row
/// lock in `tx`.
pub async fn lock_user_writes(
    mut tx: sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
) -> Result<UserWriteTx<'_>, CoreError> {
    sqlx::query!(
        "select pg_advisory_xact_lock(hashtext($1))",
        user_id.to_string()
    )
    .execute(&mut *tx)
    .await?;
    Ok(UserWriteTx { tx, user_id })
}

/// A new transaction holding the user's write lock.
pub async fn begin_user_writes(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<UserWriteTx<'static>, CoreError> {
    lock_user_writes(pool.begin().await?, user_id).await
}
