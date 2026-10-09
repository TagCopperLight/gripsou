//! The server's own subscriber, as `main` installs it. Its own test binary:
//! the subscriber is process-wide and can only be installed once.

use sqlx::PgPool;
use tracing::Instrument;

/// Every line around a query is kept. sqlx checks whether its query log is
/// enabled on every statement; with the `log` bridge installed, that check
/// once made the next line vanish from both the terminal and the saved log.
#[sqlx::test(migrations = "../migrations")]
async fn lines_around_a_query_are_all_saved(pool: PgPool) {
    let mut writer = gripsou_core::logs::install(tracing_subscriber::EnvFilter::new("info"));

    async {
        tracing::info!(target: "gripsou_test", "before");
        let _: i64 = sqlx::query_scalar("select 1::bigint")
            .fetch_one(&pool)
            .await
            .unwrap();
        tracing::info!(target: "gripsou_test", "after");
    }
    .instrument(tracing::info_span!(target: "gripsou_test", "sync"))
    .await;
    writer.flush(&pool).await;

    let saved: Vec<String> = sqlx::query_scalar("select message from log order by id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(saved, ["before", "after"]);
}
