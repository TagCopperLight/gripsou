//! What every [`db_test`](super::db_test) runs: a fresh database for the test.

use std::future::Future;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::pin::Pin;
use std::str::FromStr;
use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{AssertSqlSafe, Connection, Executor, PgConnection, PgPool};

use super::MIGRATOR;

/// A test's return value: `()`, or a `Result` that fails it when `Err`.
pub trait Outcome {
    fn passed(&self) -> bool;
}

impl Outcome for () {
    fn passed(&self) -> bool {
        true
    }
}

impl<T, E> Outcome for Result<T, E> {
    fn passed(&self) -> bool {
        self.is_ok()
    }
}

/// Runs `test` on its own database, copied from `DATABASE_URL`'s `template1`
/// and migrated by [`MIGRATOR`], on a current-thread runtime. The database is
/// dropped when the test passes and kept for a look when it fails, until the
/// test runs again.
#[doc(hidden)]
pub fn run_db_test<R: Outcome>(
    path: &'static str,
    test: fn(PgPool) -> Pin<Box<dyn Future<Output = R>>>,
) -> R {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("start the test runtime")
        .block_on(async move {
            let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
            let name = db_name(path);
            let mut admin = PgConnection::connect(&url)
                .await
                .expect("connect to DATABASE_URL");
            admin
                .execute(AssertSqlSafe(format!(
                    "drop database if exists {name} with (force)"
                )))
                .await
                .expect("drop the test's earlier database");
            // FILE_COPY copies template1's files where the default strategy
            // writes every page to the WAL: about twice as fast here.
            admin
                .execute(AssertSqlSafe(format!(
                    "create database {name} strategy file_copy"
                )))
                .await
                .expect("create the test database");

            let options = PgConnectOptions::from_str(&url)
                .expect("parse DATABASE_URL")
                .database(&name);
            // On a connection of its own, so the test starts with no session
            // state from the migrations.
            let mut conn = PgConnection::connect_with(&options)
                .await
                .expect("connect to the test database");
            MIGRATOR
                .run(&mut conn)
                .await
                .expect("migrate the test database");
            conn.close().await.expect("close the migration connection");

            let pool = PgPoolOptions::new()
                .max_connections(5)
                .idle_timeout(Duration::from_secs(1))
                .connect_lazy_with(options);
            let outcome = test(pool.clone()).await;
            if tokio::time::timeout(Duration::from_secs(10), pool.close())
                .await
                .is_err()
            {
                eprintln!("test {path} held onto its pool after it ended");
            }

            if outcome.passed() {
                admin
                    .execute(AssertSqlSafe(format!("drop database {name} with (force)")))
                    .await
                    .expect("drop the test database");
            }
            outcome
        })
}

/// One name per test, so a rerun replaces the database a failure left.
fn db_name(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("_gripsou_test_{:016x}", hasher.finish())
}
