//! Who is calling: the client's IP and browser, as the request shows them.

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::HeaderMap;
use axum::http::request::Parts;
use std::net::SocketAddr;

use crate::error::ApiError;

/// The caller's address and User-Agent (empty when the browser sent none).
#[derive(Debug, Clone)]
pub struct Client {
    pub ip: String,
    pub user_agent: String,
}

impl Client {
    pub fn new(headers: &HeaderMap, peer: SocketAddr) -> Client {
        Client {
            ip: client_ip(headers, peer),
            user_agent: headers
                .get(axum::http::header::USER_AGENT)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string(),
        }
    }

    /// The User-Agent, when there is one.
    pub fn browser(&self) -> Option<&str> {
        Some(self.user_agent.as_str()).filter(|ua| !ua.is_empty())
    }
}

impl<S: Send + Sync> FromRequestParts<S> for Client {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        let ConnectInfo(peer) = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .copied()
            .ok_or_else(|| ApiError::internal("no peer address"))?;
        Ok(Client::new(&parts.headers, peer))
    }
}

/// Client IP: the last X-Forwarded-For hop, which the nearest proxy wrote
/// (earlier hops come from the client), else the direct peer address.
/// The per-IP login limit relies on it, so the backend must sit behind a
/// proxy that sets the header; Caddy replaces it, others append to it.
fn client_ip(headers: &HeaderMap, peer: SocketAddr) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|xff| xff.rsplit(',').next())
        .map(str::trim)
        .filter(|ip| !ip.is_empty())
        .map_or_else(|| peer.ip().to_string(), str::to_string)
}

/// Best-effort friendly device label. A self-hosted app needs only a small
/// heuristic; unknown parts degrade to "Unknown …". Order matters: Edge/Opera
/// UAs also contain "Chrome", and Chrome UAs also contain "Safari".
pub fn device_name(ua: &str) -> String {
    let browser = if ua.contains("Edg/") {
        "Edge"
    } else if ua.contains("OPR/") || ua.contains("Opera") {
        "Opera"
    } else if ua.contains("Firefox/") {
        "Firefox"
    } else if ua.contains("Chrome/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else {
        "Unknown browser"
    };
    let os = if ua.contains("Windows") {
        "Windows"
    } else if ua.contains("iPhone") || ua.contains("iPad") {
        // Their UAs also say "Mac OS X".
        "iOS"
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        "macOS"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("Linux") {
        "Linux"
    } else {
        "Unknown OS"
    };
    format!("{browser} on {os}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_ip_takes_the_hop_the_nearest_proxy_wrote() {
        let peer: SocketAddr = "10.0.0.9:443".parse().unwrap();
        let mut h = HeaderMap::new();
        assert_eq!(client_ip(&h, peer), "10.0.0.9");
        h.insert("x-real-ip", "6.6.6.6".parse().unwrap());
        assert_eq!(client_ip(&h, peer), "10.0.0.9");
        h.insert("x-forwarded-for", "6.6.6.6, 203.0.113.7".parse().unwrap());
        assert_eq!(client_ip(&h, peer), "203.0.113.7");
    }

    #[test]
    fn parses_common_user_agents() {
        let chrome_mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
            (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
        assert_eq!(device_name(chrome_mac), "Chrome on macOS");

        let ff_linux = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
        assert_eq!(device_name(ff_linux), "Firefox on Linux");

        let edge_win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
            (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
        assert_eq!(device_name(edge_win), "Edge on Windows");

        let iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
        assert_eq!(device_name(iphone), "Safari on iOS");
        let ipad = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
        assert_eq!(device_name(ipad), "Safari on iOS");
        assert_eq!(device_name("weird"), "Unknown browser on Unknown OS");
    }
}
