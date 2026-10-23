use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

fn test_key() -> gripsou_api::TotpKey {
    gripsou_api::TotpKey::parse(Some(&"a".repeat(64))).unwrap()
}
fn test_passkeys() -> gripsou_api::Passkeys {
    gripsou_api::Passkeys::parse(Some("https://gripsou.test")).unwrap()
}

#[tokio::test]
async fn public_health_auth_cors_static_fallback_and_webhook_limit() {
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@localhost/unused")
        .unwrap();
    let dir = std::env::temp_dir().join(format!("gripsou-router-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "<html>SPA fixture</html>").unwrap();
    let app = gripsou_api::router(
        db,
        &dir,
        vec!["http://example.test".into()],
        test_key(),
        test_passkeys(),
    );
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
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/holdings")
                .header("origin", "http://example.test")
                .header("access-control-request-method", "GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        r.headers()["access-control-allow-origin"],
        "http://example.test"
    );
    // A throttled login's wait must be readable from another origin.
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .header("origin", "http://example.test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.headers()["access-control-expose-headers"], "retry-after");
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
    let app = gripsou_api::router(db, &dir, vec![], test_key(), test_passkeys());
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
    let app = gripsou_api::router(db, &dir, vec![], test_key(), test_passkeys());

    for path in ["/api/health", "/api/holdings", "/", "/some/spa/route"] {
        let r = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let h = r.headers();
        assert_eq!(
            h["content-security-policy"],
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob: https://cdn.brandfetch.io; font-src 'self' data:; connect-src 'self'; \
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
            "{path}"
        );
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
    let app = gripsou_api::router(
        db,
        std::path::Path::new("/nonexistent"),
        vec![],
        test_key(),
        test_passkeys(),
    );
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
