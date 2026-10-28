use gripsou_core::repo::provider_config::{load, set_field};
use gripsou_core::testkit;
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn values_round_trip_encrypted(pool: PgPool) {
    let key = testkit::encryption_key();
    set_field(&pool, &key, "powens", "client_secret", Some("s3cret-value"))
        .await
        .unwrap();
    let c = set_field(&pool, &key, "powens", "domain", Some("x.biapi.pro"))
        .await
        .unwrap();
    assert_eq!(c.get("powens", "client_secret"), Some("s3cret-value"));
    assert_eq!(c.get("powens", "domain"), Some("x.biapi.pro"));

    let raw: String =
        sqlx::query_scalar("select provider_config::text from app_settings where id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        !raw.contains("s3cret-value") && !raw.contains("x.biapi.pro"),
        "stored in clear: {raw}"
    );

    let loaded = load(&pool, &key).await.unwrap();
    assert_eq!(loaded.config, c);
    assert!(loaded.unreadable.is_empty());
}

#[sqlx::test(migrations = "../migrations")]
async fn none_removes_the_field(pool: PgPool) {
    let key = testkit::encryption_key();
    set_field(&pool, &key, "jev", "api_key", Some("k"))
        .await
        .unwrap();
    let c = set_field(&pool, &key, "jev", "api_key", None)
        .await
        .unwrap();
    assert_eq!(c.provider("jev"), None);
    let raw: String =
        sqlx::query_scalar("select provider_config::text from app_settings where id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(raw, "{}");
}

#[sqlx::test(migrations = "../migrations")]
async fn a_bundle_under_another_key_is_reported_not_fatal(pool: PgPool) {
    set_field(
        &pool,
        &testkit::encryption_key(),
        "jev",
        "api_key",
        Some("k"),
    )
    .await
    .unwrap();
    let other = gripsou_core::crypto::EncryptionKey::parse(Some(&"b".repeat(64))).unwrap();
    let loaded = load(&pool, &other).await.unwrap();
    assert_eq!(loaded.config.provider("jev"), None);
    assert_eq!(loaded.unreadable, vec!["jev".to_string()]);
    // Saving under the new key starts that provider afresh.
    let c = set_field(&pool, &other, "jev", "api_key", Some("k2"))
        .await
        .unwrap();
    assert_eq!(c.get("jev", "api_key"), Some("k2"));
}
