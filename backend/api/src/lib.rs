mod accounts;
mod admin;
pub mod auth;
mod budget;
pub mod cli;
mod connections;
pub mod error;
mod holdings;
mod prefs;
pub mod routes;
mod security_headers;
#[cfg(test)]
mod testkit;
mod transactions;
mod wire;
pub mod wire_ts;

use axum::Router;
use axum::extract::FromRef;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderValue, Response};
use serde::Serialize;
use std::sync::Arc;

use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeader;
use tower_http::trace::TraceLayer;

pub use auth::passkey::Passkeys;

use crate::auth::throttle::Throttles;
use crate::error::{ApiError, Json};
use gripsou_core::crypto::EncryptionKey;

#[derive(Clone, FromRef)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub throttles: Arc<Throttles>,
    /// Encrypts the authenticator secrets (and the provider credentials:
    /// the same key the jobs hold).
    pub key: EncryptionKey,
    pub jobs: Arc<gripsou_jobs::Deps>,
    pub passkeys: Passkeys,
}

fn member_routes() -> routes::Routes {
    routes::Routes::default()
        .get("/health", health)
        .merge(auth::routes())
        .merge(accounts::routes())
        .merge(transactions::routes())
        .merge(budget::routes())
        .merge(holdings::routes())
        .merge(connections::routes())
}

/// Every route under `/api`, the admin ones included.
fn api_routes() -> routes::Routes {
    member_routes().merge(admin::routes())
}

pub fn router(
    db: sqlx::PgPool,
    static_dir: &std::path::Path,
    jobs: Arc<gripsou_jobs::Deps>,
    passkeys: Passkeys,
) -> Router {
    let state = AppState {
        db,
        throttles: Arc::new(Throttles::default()),
        key: jobs.key.clone(),
        jobs,
        passkeys,
    };

    let index_html = static_dir.join("index.html");

    let api = member_routes()
        .into_router()
        .merge(admin::router(state.clone()))
        // An unknown API path is an API error, not the SPA's index.html.
        .fallback(|| async { ApiError::NotFound("no such API route") })
        .with_state(state);

    // Per-request span: every line a handler logs carries request_id, method,
    // the route pattern (not the raw path, full of ids) and, once the session is
    // resolved, user_id. 5xx are logged by `ApiError::internal()` with their cause, so the
    // response line itself is debug.
    let trace_layer = TraceLayer::new_for_http()
        .make_span_with(|req: &axum::http::Request<axum::body::Body>| {
            let route = req
                .extensions()
                .get::<axum::extract::MatchedPath>()
                .map(|p| p.as_str().to_string())
                .unwrap_or_else(|| "unmatched".into());
            tracing::info_span!(
                "request",
                request_id = %uuid::Uuid::new_v4(),
                method = %req.method(),
                route = %route,
                user_id = tracing::field::Empty,
            )
        })
        .on_request(())
        .on_failure(())
        .on_response(
            |response: &axum::http::Response<axum::body::Body>,
             latency: std::time::Duration,
             _span: &tracing::Span| {
                tracing::debug!(
                    status = response.status().as_u16(),
                    duration_ms = latency.as_millis() as u64,
                    "response"
                );
            },
        );

    // Vite names every file under /assets after a hash of its content, so a
    // browser may keep one forever: a new build ships new names. Only
    // successes, or a missing file would stay missing for a year.
    let assets = SetResponseHeader::overriding(
        ServeDir::new(static_dir.join("assets")),
        CACHE_CONTROL,
        |res: &Response<_>| {
            res.status()
                .is_success()
                .then(|| HeaderValue::from_static("public, max-age=31536000, immutable"))
        },
    );
    // Compressed here, as nothing in front of the app is assumed to do it:
    // the JavaScript shrinks to about a third.
    let static_files = Router::new()
        .nest_service("/assets", assets)
        .fallback_service(ServeDir::new(static_dir).not_found_service(ServeFile::new(index_html)))
        .layer(CompressionLayer::new());

    Router::new()
        .nest("/api", api.layer(trace_layer))
        .merge(static_files)
        .layer(axum::middleware::from_fn(
            security_headers::security_headers,
        ))
}

#[derive(Serialize, ts_rs::TS)]
struct Health {
    status: &'static str,
    version: &'static str,
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        version: env!("GRIPSOU_VERSION"),
    })
}
