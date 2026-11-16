//! Set here, not by the reverse proxy, so they hold whatever sits in front. The login token lives in browser storage: `script-src 'self'` keeps an injected script from reading it.

use axum::extract::Request;
use axum::http::{HeaderValue, header};
use axum::middleware::Next;
use axum::response::Response;

/// Inline styles stay allowed (React style props, ECharts); scripts get no exception. Logos come from Brandfetch's CDN; Vite inlines small fonts as `data:` URLs.
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob: https://cdn.brandfetch.io; font-src 'self' data:; connect-src 'self'; \
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

pub(crate) async fn security_headers(req: Request, next: Next) -> Response {
    // Behind Caddy the scheme only survives in X-Forwarded-Proto. HSTS must never reach a localhost dev server.
    let https = req
        .headers()
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|p| p.eq_ignore_ascii_case("https"));
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CSP),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    if https {
        h.insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000"),
        );
    }
    res
}
