use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

fn app(db: sqlx::PgPool, static_dir: &std::path::Path) -> axum::Router {
    let passkeys = gripsou_api::Passkeys::parse(Some("https://gripsou.test")).unwrap();
    gripsou_api::router(
        db,
        static_dir,
        std::sync::Arc::new(gripsou_jobs::testing::deps()),
        passkeys,
    )
}

#[tokio::test]
async fn public_health_auth_static_fallback_and_webhook_limit() {
    // Short wait: a route reaching the database fails fast instead of
    // retrying the connection for the default 30 s.
    let db = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_secs(1))
        .connect_lazy("postgres://unused:unused@localhost/unused")
        .unwrap();
    let dir = std::env::temp_dir().join(format!("gripsou-router-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "<html>SPA fixture</html>").unwrap();
    let app = app(db, &dir);
    for (path, status) in [
        ("/api/health", StatusCode::OK),
        ("/api/holdings", StatusCode::UNAUTHORIZED),
        ("/api/auth/mfa/status", StatusCode::UNAUTHORIZED),
        ("/bookmarked/path", StatusCode::NOT_FOUND),
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), status);
    }
    // Passwordless sign-in starts without a session (the unused pool makes
    // it fail later, but never as unauthorised).
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/passkey/options")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_ne!(r.status(), StatusCode::UNAUTHORIZED);
    let r = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/webhooks/bench")
                .body(Body::from(vec![0; 32 * 1024 * 1024 + 1]))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::PAYLOAD_TOO_LARGE);
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn static_files_are_compressed_and_hashed_assets_cached_forever() {
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@localhost/unused")
        .unwrap();
    let dir = std::env::temp_dir().join(format!("gripsou-router-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    std::fs::write(
        dir.join("index.html"),
        "<html>SPA fixture</html>".repeat(10),
    )
    .unwrap();
    std::fs::write(
        dir.join("assets/index-abc.js"),
        "console.log(1);".repeat(100),
    )
    .unwrap();
    let app = app(db, &dir);
    let get = |path: &str| {
        Request::builder()
            .uri(path)
            .header("accept-encoding", "br, gzip")
            .body(Body::empty())
            .unwrap()
    };

    let r = app
        .clone()
        .oneshot(get("/assets/index-abc.js"))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.headers()["content-encoding"], "br");
    assert_eq!(
        r.headers()["cache-control"],
        "public, max-age=31536000, immutable"
    );

    // Only hashed assets get the long cache: never the page naming them, nor a
    // missing asset.
    for (path, status) in [
        ("/", StatusCode::OK),
        ("/assets/gone.js", StatusCode::NOT_FOUND),
    ] {
        let r = app.clone().oneshot(get(path)).await.unwrap();
        assert_eq!(r.status(), status);
        assert!(!r.headers().contains_key("cache-control"), "{path}");
    }
    let r = app.oneshot(get("/")).await.unwrap();
    assert_eq!(r.headers()["content-encoding"], "br");
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn every_response_carries_the_security_headers() {
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@localhost/unused")
        .unwrap();
    let dir = std::env::temp_dir().join(format!("gripsou-router-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "<html>SPA fixture</html>").unwrap();
    let app = app(db, &dir);

    for path in ["/api/health", "/api/holdings", "/", "/some/spa/route"] {
        let r = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let h = r.headers();
        let csp = h["content-security-policy"].to_str().unwrap();
        assert!(csp.contains("script-src 'self';"), "{path}: {csp}");
        assert_eq!(h["x-content-type-options"], "nosniff", "{path}");
        assert_eq!(h["referrer-policy"], "no-referrer", "{path}");
        assert_eq!(h["x-frame-options"], "DENY", "{path}");
        assert!(
            !h.contains_key("strict-transport-security"),
            "{path}: plain http"
        );
    }

    let r = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .header("x-forwarded-proto", "https")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.headers()["strict-transport-security"], "max-age=31536000");
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn totp_setup_without_a_token_is_unauthorized() {
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@localhost/unused")
        .unwrap();
    let app = app(db, std::path::Path::new("/nonexistent"));
    let r = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/mfa/totp/setup")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
}

/// A member's bearer token.
async fn member_token(pool: &sqlx::PgPool) -> String {
    let member = gripsou_core::testkit::seed_user(pool).await;
    let token = gripsou_api::auth::generate_token();
    gripsou_core::repo::session::create(
        pool,
        member,
        &gripsou_api::auth::hash_token(&token),
        None,
        None,
        false,
    )
    .await
    .unwrap();
    token
}

/// A chart range the server doesn't know is refused like any other filter,
/// never read as the widest window.
#[sqlx::test(migrations = "../migrations")]
async fn an_unknown_range_is_a_400(pool: sqlx::PgPool) {
    let token = member_token(&pool).await;
    let app = app(pool, &std::env::temp_dir());
    for (range, status) in [("max", StatusCode::OK), ("10y", StatusCode::BAD_REQUEST)] {
        for path in ["/api/dashboard/net-worth", "/api/accounts/series"] {
            let r = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("{path}?range={range}"))
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(r.status(), status, "{path}?range={range}");
        }
    }
}

/// A body that isn't JSON, or is JSON of the wrong shape (an unknown lot
/// type or category kind), is a 400 and writes nothing.
#[sqlx::test(migrations = "../migrations")]
async fn a_malformed_body_is_a_400(pool: sqlx::PgPool) {
    let token = member_token(&pool).await;
    let app = app(pool.clone(), &std::env::temp_dir());
    let holding = uuid::Uuid::new_v4();
    for (method, path, body) in [
        (
            "POST",
            "/api/budget/categories".to_string(),
            "{".to_string(),
        ),
        (
            "POST",
            "/api/budget/categories".into(),
            r##"{"name":"Climbing","color":"#123456","kind":"savings"}"##.into(),
        ),
        (
            "PUT",
            format!("/api/holdings/{holding}/lots"),
            r#"{"adds":[{"type":"dividend","date":"2024-05-02","quantity":"1","unitPrice":"1"}]}"#
                .into(),
        ),
    ] {
        let r = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(&path)
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            r.status(),
            StatusCode::BAD_REQUEST,
            "{method} {path} {body}"
        );
    }
    let custom: i64 =
        sqlx::query_scalar("select count(*) from budget_category where name = 'Climbing'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(custom, 0);
}
