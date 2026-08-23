pub mod map;
pub mod model;

use async_trait::async_trait;
use gripsou_core::dto::SyncResult;
use gripsou_core::provider::{AccountProvider, CompleteConnect, ConnectInit, ProviderError};

pub struct PowensProvider {
    pub(crate) client_id: String,
    pub(crate) client_secret: String,
    /// Where Powens sends the user after the bank-connection webview.
    pub(crate) redirect_uri: String,
    /// Raw domain, e.g. "myapp.biapi.pro". Used in the webview URL's `domain` param.
    pub(crate) domain: String,
    /// Scheme + host, no trailing slash, no /2.0. Used as REST API base.
    pub(crate) origin: String,
    pub(crate) http: reqwest::Client,
    /// Optional HMAC secret for verifying incoming Powens webhooks.
    pub(crate) webhook_secret: Option<String>,
}

impl PowensProvider {
    pub fn from_env() -> Option<Self> {
        let client_id = std::env::var("POWENS_CLIENT_ID").ok()?;
        let client_secret = std::env::var("POWENS_CLIENT_SECRET").ok()?;
        let domain = std::env::var("POWENS_DOMAIN").ok()?;
        let redirect_uri = std::env::var("POWENS_REDIRECT_URI").ok()?;
        Some(Self {
            client_id,
            client_secret,
            redirect_uri,
            origin: format!("https://{domain}"),
            domain,
            http: reqwest::Client::new(),
            webhook_secret: std::env::var("POWENS_WEBHOOK_SECRET").ok(),
        })
    }

    /// `path` may start with `/` or not; both are accepted.
    pub(crate) fn api_url(&self, path: &str) -> String {
        format!("{}/2.0/{}", self.origin, path.trim_start_matches('/'))
    }

    /// Test-only constructor pointing the REST API base at a mock server.
    /// Not `#[cfg(test)]`-gated because integration tests in `providers/tests/`
    /// build against this crate as an ordinary dependency, where `cfg(test)`
    /// items don't exist at all.
    #[doc(hidden)]
    pub fn for_test(base_url: &str) -> Self {
        Self {
            client_id: "test-client".into(),
            client_secret: "test-secret".into(),
            redirect_uri: "https://gripsou.test/connections/callback".into(),
            domain: "test.biapi.pro".into(),
            origin: base_url.to_string(),
            http: reqwest::Client::new(),
            webhook_secret: None,
        }
    }

    #[doc(hidden)]
    pub fn for_test_with_secret(base_url: &str, secret: &str) -> Self {
        let mut p = Self::for_test(base_url);
        p.webhook_secret = Some(secret.to_string());
        p
    }

    /// Full history, every sync. Powens' `last_update` filter returns only rows
    /// edited since a timestamp and therefore cannot backfill, so incremental is
    /// unsafe; full-fetch + external_id dedup is idempotent instead (§6.1).
    ///
    /// ponytail: fetches the whole history; add a min_date window if payloads
    /// grow past a few thousand rows (largest observed: 2,111).
    async fn fetch_transactions(
        &self,
        auth_token: &str,
    ) -> Result<Vec<model::PowensTransaction>, ProviderError> {
        let mut url = self.api_url("/users/me/transactions?limit=1000");
        let mut all = Vec::new();
        // Bounded so a provider bug cannot spin forever: 1000 rows/page.
        for _ in 0..100 {
            let resp = self
                .http
                .get(&url)
                .bearer_auth(auth_token)
                .send()
                .await
                .map_err(|e| ProviderError::Other(e.to_string()))?;
            if !resp.status().is_success() {
                return Err(ProviderError::Other(format!(
                    "GET /users/me/transactions failed: {}",
                    resp.status()
                )));
            }
            let page: model::TransactionsResponse = resp
                .json()
                .await
                .map_err(|e| ProviderError::Other(format!("transactions decode error: {e}")))?;
            all.extend(page.transactions);
            match page.links.next {
                Some(next) => url = next.href,
                None => return Ok(all),
            }
        }
        tracing::warn!("powens transactions: page limit hit, history may be truncated");
        Ok(all)
    }
}

#[async_trait]
impl AccountProvider for PowensProvider {
    fn key(&self) -> &str {
        "powens"
    }

    /// Build the Powens webview URL. The webview is always at webview.powens.com —
    /// no API call needed here. Powens creates an anonymous user on its side and
    /// returns a one-time `code` in the callback for us to exchange.
    async fn connect(&self) -> Result<ConnectInit, ProviderError> {
        let webview_url = format!(
            "https://webview.powens.com/en/connect\
             ?domain={domain}\
             &client_id={client_id}\
             &redirect_uri={redirect_uri}",
            domain = urlencoding::encode(&self.domain),
            client_id = urlencoding::encode(&self.client_id),
            redirect_uri = urlencoding::encode(&self.redirect_uri),
        );
        Ok(ConnectInit {
            redirect_url: Some(webview_url),
        })
    }

    /// Exchange the `code` Powens returns in its callback for a permanent access token.
    /// `callback` is the raw query string from the redirect, e.g. `"code=X&connection_id=Y"`.
    async fn complete_connect(&self, callback: &str) -> Result<CompleteConnect, ProviderError> {
        #[derive(serde::Deserialize)]
        struct TokenAccessResponse {
            access_token: String,
        }

        #[derive(serde::Deserialize)]
        struct Me {
            id: i64,
        }

        let code = callback
            .split('&')
            .find_map(|pair| {
                let (k, v) = pair.split_once('=')?;
                (k == "code").then(|| v.to_string())
            })
            .ok_or_else(|| ProviderError::Other("missing 'code' in Powens callback".into()))?;

        let resp = self
            .http
            .post(self.api_url("/auth/token/access"))
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("code", &code),
            ])
            .send()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(ProviderError::Other(format!(
                "POST /auth/token/access failed: {}",
                resp.status()
            )));
        }

        let token_resp: TokenAccessResponse = resp
            .json()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let me_resp = self
            .http
            .get(self.api_url("/users/me"))
            .bearer_auth(&token_resp.access_token)
            .send()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        if !me_resp.status().is_success() {
            return Err(ProviderError::Other(format!(
                "GET /users/me failed: {}",
                me_resp.status()
            )));
        }

        let me: Me = me_resp
            .json()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let connection_id = callback.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            (k == "connection_id").then(|| v.to_string())
        });

        let mut provider_meta = serde_json::json!({ "powens_user_id": me.id.to_string() });
        if let Some(cid) = connection_id {
            provider_meta["external_connection_id"] = serde_json::Value::String(cid);
        }

        Ok(CompleteConnect {
            credentials: serde_json::json!({ "auth_token": token_resp.access_token }),
            provider_meta,
        })
    }

    async fn sync(&self, credentials: &serde_json::Value) -> Result<SyncResult, ProviderError> {
        use model::{AccountsResponse, InvestmentsResponse};

        let auth_token = credentials["auth_token"]
            .as_str()
            .ok_or_else(|| ProviderError::Other("missing auth_token in credentials".into()))?;

        let accounts_resp = self
            .http
            .get(self.api_url("/users/me/accounts"))
            .bearer_auth(auth_token)
            .send()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        if !accounts_resp.status().is_success() {
            return Err(ProviderError::Other(format!(
                "GET /users/me/accounts failed: {}",
                accounts_resp.status()
            )));
        }

        let accounts_text = accounts_resp
            .text()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;
        let accounts: AccountsResponse = match serde_json::from_str(&accounts_text) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!("powens accounts decode error: {e}");
                tracing::debug!(
                    "powens accounts raw body: {}",
                    accounts_text.chars().take(500).collect::<String>()
                );
                return Err(ProviderError::Other(format!(
                    "accounts decode error: {}",
                    e
                )));
            }
        };

        let investments_resp = self
            .http
            .get(self.api_url("/users/me/investments"))
            .bearer_auth(auth_token)
            .send()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        if !investments_resp.status().is_success() {
            return Err(ProviderError::Other(format!(
                "GET /users/me/investments failed: {}",
                investments_resp.status()
            )));
        }

        let investments_text = investments_resp
            .text()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;
        let investments: InvestmentsResponse = match serde_json::from_str(&investments_text) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!("powens investments decode error: {e}");
                tracing::debug!(
                    "powens investments raw body: {}",
                    investments_text.chars().take(500).collect::<String>()
                );
                return Err(ProviderError::Other(format!(
                    "investments decode error: {}",
                    e
                )));
            }
        };

        // Connections carry the institution (one connector per connection).
        // Failure here is non-fatal: leave institution empty rather than fail
        // the whole sync (the ingest guard won't clobber a prior good value).
        let connections = {
            let resp = self
                .http
                .get(self.api_url("/users/me/connections?expand=connector"))
                .bearer_auth(auth_token)
                .send()
                .await
                .map_err(|e| ProviderError::Other(e.to_string()))?;
            if resp.status().is_success() {
                resp.json::<model::ConnectionsResponse>()
                    .await
                    .map(|r| r.connections)
                    .unwrap_or_default()
            } else {
                Vec::new()
            }
        };

        let transactions = self.fetch_transactions(auth_token).await?;

        let mut result = map::map_sync(&accounts.accounts, &investments.investments, &transactions);
        result.institution = map::map_institution(&connections);
        Ok(result)
    }

    fn webhooks_enabled(&self) -> bool {
        self.webhook_secret.is_some()
    }

    async fn request_refresh(
        &self,
        credentials: &serde_json::Value,
        provider_meta: &serde_json::Value,
    ) -> Result<(), ProviderError> {
        let token = credentials["auth_token"]
            .as_str()
            .ok_or_else(|| ProviderError::Other("missing auth_token".into()))?;
        let cid = provider_meta["external_connection_id"]
            .as_str()
            .ok_or_else(|| ProviderError::Other("missing external_connection_id".into()))?;
        let resp = self
            .http
            .put(self.api_url(&format!("/users/me/connections/{cid}")))
            .bearer_auth(token)
            .query(&[("psu_requested", "false")])
            .send()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;
        // 409: Powens considers the connection already up to date (or a sync is
        // already running) and won't emit a webhook — signal a benign conflict so
        // the caller can fall back to a direct fetch instead of erroring.
        if resp.status() == reqwest::StatusCode::CONFLICT {
            return Err(ProviderError::Conflict);
        }
        if !resp.status().is_success() {
            return Err(ProviderError::Other(format!(
                "PUT connection refresh failed: {}",
                resp.status()
            )));
        }
        Ok(())
    }

    fn verify_webhook(
        &self,
        path: &str,
        headers: &std::collections::HashMap<String, String>,
        body: &[u8],
    ) -> Result<Option<gripsou_core::provider::WebhookSignal>, ProviderError> {
        use base64::{Engine, engine::general_purpose::STANDARD};
        use hmac::{Hmac, Mac};
        use sha2::Sha256;

        let secret = self
            .webhook_secret
            .as_ref()
            .ok_or_else(|| ProviderError::Other("webhook secret not configured".into()))?;
        let date = headers
            .get("bi-signature-date")
            .ok_or_else(|| ProviderError::Other("missing BI-Signature-Date".into()))?;
        let given = headers
            .get("bi-signature")
            .ok_or_else(|| ProviderError::Other("missing BI-Signature".into()))?;

        let body_str = std::str::from_utf8(body)
            .map_err(|_| ProviderError::Other("non-utf8 webhook body".into()))?;
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
            .map_err(|e| ProviderError::Other(e.to_string()))?;
        mac.update(format!("POST.{path}.{date}.{body_str}").as_bytes());
        let expected = STANDARD.encode(mac.finalize().into_bytes());

        // Compare decoded bytes; timing leakage is negligible (HMAC over unknown secret).
        let given_bytes = STANDARD.decode(given).unwrap_or_default();
        let expected_bytes = STANDARD.decode(&expected).unwrap_or_default();
        if given_bytes.is_empty() || given_bytes != expected_bytes {
            return Err(ProviderError::Other("bad webhook signature".into()));
        }

        let env: model::WebhookEnvelope =
            serde_json::from_slice(body).map_err(|e| ProviderError::Other(e.to_string()))?;
        Ok(env
            .connection
            .map(|c| gripsou_core::provider::WebhookSignal {
                provider_connection_id: c.id.to_string(),
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn sign(secret: &str, path: &str, date: &str, body: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(format!("POST.{path}.{date}.{body}").as_bytes());
        STANDARD.encode(mac.finalize().into_bytes())
    }

    #[tokio::test]
    async fn connect_builds_webview_url_with_correct_params() {
        let p = PowensProvider::for_test("http://ignored-in-connect");
        let init = p.connect().await.unwrap();
        let url = init.redirect_url.expect("redirect_url is set");

        assert!(
            url.starts_with("https://webview.powens.com/en/connect"),
            "url={url}"
        );
        assert!(url.contains("domain=test.biapi.pro"), "url={url}");
        assert!(url.contains("client_id=test-client"), "url={url}");
        assert!(url.contains("redirect_uri="), "url={url}");
        assert!(
            !url.contains("auth_token"),
            "url must not have auth_token: {url}"
        );
    }

    #[tokio::test]
    async fn complete_connect_exchanges_code_for_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2.0/auth/token/access"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "perm-abc",
                "token_type": "Bearer"
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "id": 42 })))
            .mount(&server)
            .await;

        let p = PowensProvider::for_test(&server.uri());
        let out = p
            .complete_connect("code=exchange-code-123&connection_id=99")
            .await
            .unwrap();
        assert_eq!(out.credentials["auth_token"], "perm-abc");
        assert_eq!(out.provider_meta["external_connection_id"], "99");
        assert_eq!(out.provider_meta["powens_user_id"], "42");
    }

    #[tokio::test]
    async fn complete_connect_errors_without_code() {
        let server = MockServer::start().await;
        let p = PowensProvider::for_test(&server.uri());
        assert!(p.complete_connect("no_code_here=x").await.is_err());
    }

    #[tokio::test]
    async fn complete_connect_propagates_token_exchange_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2.0/auth/token/access"))
            .respond_with(ResponseTemplate::new(400))
            .mount(&server)
            .await;

        let p = PowensProvider::for_test(&server.uri());
        assert!(p.complete_connect("code=bad").await.is_err());
    }

    #[tokio::test]
    async fn complete_connect_without_connection_id() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2.0/auth/token/access"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "perm-abc",
                "token_type": "Bearer"
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "id": 42 })))
            .mount(&server)
            .await;

        let p = PowensProvider::for_test(&server.uri());
        let out = p.complete_connect("code=exchange-code-123").await.unwrap();
        assert!(
            out.provider_meta.get("external_connection_id").is_none(),
            "external_connection_id should not be present"
        );
        assert_eq!(out.provider_meta["powens_user_id"], "42");
        assert_eq!(out.credentials["auth_token"], "perm-abc");
    }

    #[tokio::test]
    async fn sync_fetches_and_maps_accounts_and_investments() {
        let server = MockServer::start().await;

        let accounts: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/powens/accounts.json"))
                .unwrap();
        let investments: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/powens/investments.json"))
                .unwrap();

        Mock::given(method("GET"))
            .and(path("/2.0/users/me/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(&accounts))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me/investments"))
            .respond_with(ResponseTemplate::new(200).set_body_json(&investments))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me/transactions"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "transactions": [] })),
            )
            .mount(&server)
            .await;

        let p = PowensProvider::for_test(&server.uri());
        let creds = serde_json::json!({ "auth_token": "live-token" });
        let result = p.sync(&creds).await.unwrap();

        assert!(!result.accounts.is_empty(), "expected accounts");
        assert!(!result.holdings.is_empty(), "expected holdings");
    }

    #[tokio::test]
    async fn sync_errors_on_missing_auth_token() {
        let server = MockServer::start().await;
        let p = PowensProvider::for_test(&server.uri());
        assert!(p.sync(&serde_json::json!({})).await.is_err());
    }

    #[tokio::test]
    async fn sync_errors_on_failed_accounts_request() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me/accounts"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let p = PowensProvider::for_test(&server.uri());
        let creds = serde_json::json!({ "auth_token": "bad-token" });
        assert!(p.sync(&creds).await.is_err());
    }

    #[test]
    fn verify_webhook_accepts_valid_signature_and_returns_connection_id() {
        let p = PowensProvider::for_test_with_secret("http://x", "shh");
        let path = "/api/webhooks/powens";
        let date = "2022-06-27T11:08:52.577831Z";
        let body = r#"{"connection":{"id":99}}"#;
        let mut h = std::collections::HashMap::new();
        h.insert("bi-signature-date".into(), date.into());
        h.insert("bi-signature".into(), sign("shh", path, date, body));
        let sig = p
            .verify_webhook(path, &h, body.as_bytes())
            .unwrap()
            .unwrap();
        assert_eq!(sig.provider_connection_id, "99");
    }

    #[test]
    fn verify_webhook_rejects_bad_signature() {
        let p = PowensProvider::for_test_with_secret("http://x", "shh");
        let mut h = std::collections::HashMap::new();
        h.insert("bi-signature-date".into(), "d".into());
        h.insert("bi-signature".into(), "not-the-right-sig".into());
        assert!(p.verify_webhook("/api/webhooks/powens", &h, b"{}").is_err());
    }

    #[test]
    fn verify_webhook_ignores_body_without_connection() {
        let p = PowensProvider::for_test_with_secret("http://x", "shh");
        let path = "/api/webhooks/powens";
        let date = "d";
        let body = r#"{"user":{"id":1}}"#;
        let mut h = std::collections::HashMap::new();
        h.insert("bi-signature-date".into(), date.into());
        h.insert("bi-signature".into(), sign("shh", path, date, body));
        assert!(
            p.verify_webhook(path, &h, body.as_bytes())
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn sync_populates_institution_from_connections() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me/accounts"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "accounts": [] })),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me/investments"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "investments": [] })),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me/connections"))
            .and(query_param("expand", "connector"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "connections": [ { "id": 99, "connector": { "uuid": "abc-uuid-bnp", "name": "BNP Paribas" } } ]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/2.0/users/me/transactions"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "transactions": [] })),
            )
            .mount(&server)
            .await;

        let p = PowensProvider::for_test(&server.uri());
        let creds = serde_json::json!({ "auth_token": "live" });
        let out = p.sync(&creds).await.unwrap();
        assert_eq!(out.institution.key, "abc-uuid-bnp");
        assert_eq!(out.institution.name, "BNP Paribas");
    }

    #[tokio::test]
    async fn request_refresh_puts_with_psu_requested_false() {
        let server = MockServer::start().await;
        Mock::given(method("PUT"))
            .and(path("/2.0/users/me/connections/99"))
            .and(query_param("psu_requested", "false"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
            .mount(&server)
            .await;
        let p = PowensProvider::for_test(&server.uri());
        let creds = serde_json::json!({ "auth_token": "live" });
        let meta = serde_json::json!({ "external_connection_id": "99" });
        p.request_refresh(&creds, &meta).await.unwrap();
    }
}
