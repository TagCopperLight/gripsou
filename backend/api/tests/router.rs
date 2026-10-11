use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;
#[tokio::test]
async fn public_health_auth_cors_static_fallback_and_webhook_limit() {
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@localhost/unused")
        .unwrap();
    let dir = std::env::temp_dir().join(format!("gripsou-router-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "<html>SPA fixture</html>").unwrap();
    let app = gripsou_api::router(db, &dir, vec!["http://example.test".into()]);
    for (path, status) in [
        ("/api/health", StatusCode::OK),
        ("/api/holdings", StatusCode::UNAUTHORIZED),
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
