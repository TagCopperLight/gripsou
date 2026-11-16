//! The server's subscriber as `main` installs it, in its own binary: it is process-wide.

use sqlx::PgPool;
use tracing::Instrument;

/// With the `log` bridge installed, sqlx's per-statement log check makes the next line vanish.
#[gripsou_core::testkit::db_test]
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
