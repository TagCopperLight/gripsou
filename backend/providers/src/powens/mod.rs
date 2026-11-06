mod institutions;
mod map;
mod model;

/// The mapping and wire models, for the adapter's tests.
#[cfg(feature = "test-util")]
pub mod testing {
    pub mod map {
        pub use crate::powens::map::*;
    }
    pub mod model {
        pub use crate::powens::model::*;
    }
}

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use gripsou_core::dto::SyncResult;
use gripsou_core::provider::{
    AccountProvider, CompleteConnect, ConnectInit, EXTERNAL_CONNECTION_ID, ProviderError, Refresh,
    RefreshMode,
};
use gripsou_core::provider_config::{ConfigField, ProviderConfig};

use crate::registry::{About, AccountKind, Context};

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

/// Powens caps `limit` at 1000 on every list endpoint.
const PAGE_LIMIT: usize = 1000;
/// Bound so a provider bug cannot spin forever. 100 pages of 1000 rows is far
/// past any real portfolio or ledger, so reaching it means the cursor stopped
/// advancing rather than that the data is genuinely that large.
const MAX_PAGES: usize = 100;

/// One page of a Powens list endpoint: its rows, plus the cursor to the next
/// page for the endpoints that use relational pagination.
pub(crate) trait ListPage: serde::de::DeserializeOwned {
    type Item;
    fn into_parts(self) -> (Vec<Self::Item>, Option<String>);
}

impl ListPage for model::TransactionsResponse {
    type Item = model::PowensTransaction;
    fn into_parts(self) -> (Vec<Self::Item>, Option<String>) {
        (self.transactions, self.links.next.map(|l| l.href))
    }
}

impl ListPage for model::AccountsResponse {
    type Item = model::BankAccount;
    fn into_parts(self) -> (Vec<Self::Item>, Option<String>) {
        (self.accounts, self.links.next.map(|l| l.href))
    }
}

impl ListPage for model::InvestmentsResponse {
    type Item = model::Investment;
    fn into_parts(self) -> (Vec<Self::Item>, Option<String>) {
        (self.investments, self.links.next.map(|l| l.href))
    }
}

/// The webview's base address, the same for every domain.
const WEBVIEW: &str = "https://webview.powens.com/en";

/// What a Powens connection stores: its permanent user token.
#[derive(serde::Serialize, serde::Deserialize)]
struct Credentials {
    auth_token: String,
}

impl Credentials {
    fn parse(stored: &serde_json::Value) -> Result<Self, ProviderError> {
        // The value is a secret: never quoted in the error.
        serde_json::from_value(stored.clone())
            .map_err(|_| ProviderError::Other("missing Powens auth token in credentials".into()))
    }
}

/// Sends `req`, whatever status comes back. `what` names the call in errors.
async fn transport(
    req: reqwest::RequestBuilder,
    what: &str,
) -> Result<reqwest::Response, ProviderError> {
    req.send().await.map_err(|e| {
        ProviderError::Other(format!(
            "{what} failed: {}",
            gripsou_core::logs::error_chain(&e)
        ))
    })
}

/// `resp`, unless its status is not a success.
fn success(resp: reqwest::Response, what: &str) -> Result<reqwest::Response, ProviderError> {
    if !resp.status().is_success() {
        return Err(ProviderError::Other(format!(
            "{what} failed: {}",
            resp.status()
        )));
    }
    Ok(resp)
}

/// Sends `req`, refusing a non-success status.
async fn send(
    req: reqwest::RequestBuilder,
    what: &str,
) -> Result<reqwest::Response, ProviderError> {
    success(transport(req, what).await?, what)
}

async fn send_json<T: serde::de::DeserializeOwned>(
    req: reqwest::RequestBuilder,
    what: &str,
) -> Result<T, ProviderError> {
    crate::read_json(send(req, what).await?, what)
        .await
        .map_err(ProviderError::Other)
}

pub const KIND: AccountKind = AccountKind {
    about: About {
        key: "powens",
        display_name: "Powens",
        // The redirect address is not asked for: it is always the public
        // address + `/connections/callback`.
        fields: &[
            ConfigField {
                key: "client_id",
                label: "Client ID",
                secret: false,
            },
            ConfigField {
                key: "domain",
                label: "Domain",
                secret: false,
            },
            ConfigField {
                key: "client_secret",
                label: "Client secret",
                secret: true,
            },
            ConfigField {
                key: "webhook_secret",
                label: "Webhook secret",
                secret: true,
            },
        ],
    },
    description: "European bank & brokerage aggregation. Connects checking, savings, PEA and brokerage accounts.",
    build: |config, ctx| {
        PowensProvider::from_config(config, ctx).map(|p| Arc::new(p) as Arc<dyn AccountProvider>)
    },
    institution_domain: institutions::domain,
};

impl PowensProvider {
    /// `None` until client id, domain and client secret are all set.
    pub fn from_config(config: &ProviderConfig, ctx: &Context) -> Option<Self> {
        let get = |f| config.get(KIND.about.key, f).map(str::to_string);
        let domain = get("domain")?;
        Some(Self {
            client_id: get("client_id")?,
            client_secret: get("client_secret")?,
            redirect_uri: format!(
                "{}/connections/callback",
                ctx.public_url.trim_end_matches('/')
            ),
            origin: format!("https://{domain}"),
            domain,
            http: reqwest::Client::new(),
            webhook_secret: get("webhook_secret"),
        })
    }

    /// `path` may start with `/` or not; both are accepted.
    pub(crate) fn api_url(&self, path: &str) -> String {
        format!("{}/2.0/{}", self.origin, path.trim_start_matches('/'))
    }

    /// An adapter whose REST API is `base_url` (a mock server).
    #[cfg(any(test, feature = "test-util"))]
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

    #[cfg(any(test, feature = "test-util"))]
    pub fn for_test_with_secret(base_url: &str, secret: &str) -> Self {
        let mut p = Self::for_test(base_url);
        p.webhook_secret = Some(secret.to_string());
        p
    }

    /// Walks a Powens list endpoint to exhaustion.
    ///
    /// Two pagination styles are in play. Transactions hand back a
    /// `_links.next` cursor; `/accounts` and `/investments` document only
    /// `limit`/`offset`. Follow the cursor when the page carries one, fall back
    /// to offset paging when a full page arrives without one.
    ///
    /// A fetch that cannot be walked to the end is an **error, never a short
    /// list**: the ingest reads "holding absent from this sync" as "position
    /// sold" and stamps a zero snapshot for it, so a truncated page would not
    /// merely under-report — it would destroy that position's history.
    async fn fetch_all<P: ListPage>(
        &self,
        auth_token: &str,
        endpoint: &str,
    ) -> Result<Vec<P::Item>, ProviderError> {
        let base = self.api_url(&format!("{endpoint}?limit={PAGE_LIMIT}"));
        let mut url = base.clone();
        let mut all: Vec<P::Item> = Vec::new();

        for _ in 0..MAX_PAGES {
            let req = self.http.get(&url).bearer_auth(auth_token);
            let page: P = send_json(req, &format!("GET {endpoint}")).await?;
            let (items, next) = page.into_parts();
            let full_page = items.len() >= PAGE_LIMIT;
            all.extend(items);
            match next {
                Some(href) => url = href,
                None if full_page => url = format!("{base}&offset={}", all.len()),
                None => return Ok(all),
            }
        }

        Err(ProviderError::Other(format!(
            "GET {endpoint}: pagination did not terminate after {MAX_PAGES} pages ({} rows); \
             refusing to ingest a partial view",
            all.len()
        )))
    }

    /// The token's connections with their bank and sources, which carry the
    /// institution and the health. Never fatal to a sync: on any failure the
    /// sync goes on with none, so the institution keeps its last value and
    /// the health reads as unknown.
    async fn connections_for_sync(&self, auth_token: &str) -> Vec<model::Connection> {
        let req = self
            .http
            .get(self.api_url("/users/me/connections?expand=connector,sources"))
            .bearer_auth(auth_token);
        match send_json::<model::ConnectionsResponse>(req, "GET /users/me/connections").await {
            Ok(r) => r.connections,
            Err(e) => {
                tracing::warn!(
                    error = %gripsou_core::logs::error_chain(&e),
                    "institution lookup failed"
                );
                Vec::new()
            }
        }
    }
}

#[async_trait]
impl AccountProvider for PowensProvider {
    /// Powens creates an anonymous user on its side and returns a one-time
    /// `code` in the callback for us to exchange.
    async fn connect(&self) -> Result<ConnectInit, ProviderError> {
        let mut url = reqwest::Url::parse(&format!("{WEBVIEW}/connect")).expect("static URL");
        url.query_pairs_mut().extend_pairs([
            ("domain", self.domain.as_str()),
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", self.redirect_uri.as_str()),
        ]);
        Ok(ConnectInit {
            redirect_url: Some(url.to_string()),
        })
    }

    /// Exchanges the callback's `code` for a permanent user token.
    async fn complete_connect(
        &self,
        params: &HashMap<String, String>,
    ) -> Result<CompleteConnect, ProviderError> {
        #[derive(serde::Deserialize)]
        struct TokenAccessResponse {
            access_token: String,
        }

        #[derive(serde::Deserialize)]
        struct Me {
            id: i64,
        }

        let code = params
            .get("code")
            .ok_or_else(|| ProviderError::Other("missing 'code' in Powens callback".into()))?;

        let token: TokenAccessResponse = send_json(
            self.http.post(self.api_url("/auth/token/access")).form(&[
                ("grant_type", "authorization_code"),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("code", code),
            ]),
            "POST /auth/token/access",
        )
        .await?;

        let me: Me = send_json(
            self.http
                .get(self.api_url("/users/me"))
                .bearer_auth(&token.access_token),
            "GET /users/me",
        )
        .await?;

        let mut provider_meta = serde_json::json!({ "powens_user_id": me.id.to_string() });
        if let Some(cid) = params.get("connection_id") {
            provider_meta[EXTERNAL_CONNECTION_ID] = serde_json::Value::String(cid.clone());
        }

        Ok(CompleteConnect {
            credentials: serde_json::to_value(Credentials {
                auth_token: token.access_token,
            })
            .expect("plain struct"),
            provider_meta,
        })
    }

    async fn sync(&self, credentials: &serde_json::Value) -> Result<SyncResult, ProviderError> {
        let Credentials { auth_token } = Credentials::parse(credentials)?;

        let accounts = self
            .fetch_all::<model::AccountsResponse>(&auth_token, "/users/me/accounts")
            .await?;
        let investments = self
            .fetch_all::<model::InvestmentsResponse>(&auth_token, "/users/me/investments")
            .await?;
        let connections = self.connections_for_sync(&auth_token).await;

        // Full history, every sync. Powens' `last_update` filter returns only
        // rows edited since a timestamp and therefore cannot backfill, so
        // incremental is unsafe; full-fetch + external_id dedup is idempotent
        // instead. The largest history seen is 2,111 rows; a `min_date` window
        // would bound much larger ones.
        let transactions = self
            .fetch_all::<model::TransactionsResponse>(&auth_token, "/users/me/transactions")
            .await?;

        Ok(map::map_sync(
            &accounts,
            &investments,
            &transactions,
            &connections,
        ))
    }

    fn supports_manage(&self) -> bool {
        true
    }

    async fn manage(
        &self,
        credentials: &serde_json::Value,
        provider_meta: &serde_json::Value,
    ) -> Result<ConnectInit, ProviderError> {
        let Credentials { auth_token } = Credentials::parse(credentials)?;
        let connections: model::ConnectionsResponse = send_json(
            self.http
                .get(self.api_url("/users/me/connections"))
                .bearer_auth(&auth_token),
            "GET /users/me/connections",
        )
        .await?;
        // A connection with no stored external id resolves only when the token
        // holds exactly one connection; never choose an arbitrary bank.
        let stored_id = provider_meta[EXTERNAL_CONNECTION_ID].as_str();
        let connection = match stored_id {
            Some(id) => connections
                .connections
                .iter()
                .find(|c| c.id.to_string() == id),
            None if connections.connections.len() == 1 => connections.connections.first(),
            None => None,
        }
        .ok_or_else(|| {
            ProviderError::Other("unable to identify the Powens connection to manage".into())
        })?;
        #[derive(serde::Deserialize)]
        struct AccessCode {
            code: String,
        }
        let code: AccessCode = send_json(
            self.http
                .get(self.api_url("/auth/token/code"))
                .query(&[("type", "singleAccess")])
                .bearer_auth(&auth_token),
            "GET /auth/token/code",
        )
        .await?;
        let mut url = reqwest::Url::parse(&format!("{WEBVIEW}/manage")).expect("static URL");
        url.query_pairs_mut().extend_pairs([
            ("domain", self.domain.as_str()),
            ("client_id", self.client_id.as_str()),
            ("code", code.code.as_str()),
            ("connection_id", &connection.id.to_string()),
        ]);
        // Do not use the add-connection callback: it can delete a failed pending
        // row. Manage opens separately and operates on the existing connection.
        Ok(ConnectInit {
            redirect_url: Some(url.to_string()),
        })
    }

    /// Webhook-driven once a webhook secret is set, for a connection whose
    /// Powens id is known (the webhook names it).
    fn refresh_mode(&self, provider_meta: &serde_json::Value) -> RefreshMode {
        let known = provider_meta[EXTERNAL_CONNECTION_ID]
            .as_str()
            .is_some_and(|id| !id.is_empty());
        if self.webhook_secret.is_some() && known {
            RefreshMode::Webhook
        } else {
            RefreshMode::Direct
        }
    }

    async fn request_refresh(
        &self,
        credentials: &serde_json::Value,
        provider_meta: &serde_json::Value,
    ) -> Result<Refresh, ProviderError> {
        let Credentials { auth_token } = Credentials::parse(credentials)?;
        let cid = provider_meta[EXTERNAL_CONNECTION_ID]
            .as_str()
            .ok_or_else(|| ProviderError::Other(format!("missing {EXTERNAL_CONNECTION_ID}")))?;
        let what = "PUT /users/me/connections";
        let req = self
            .http
            .put(self.api_url(&format!("/users/me/connections/{cid}")))
            .bearer_auth(&auth_token)
            .query(&[("psu_requested", "false")]);
        let resp = transport(req, what).await?;
        // 409: Powens considers the connection up to date (or a sync is
        // already running) and sends no webhook.
        if resp.status() == reqwest::StatusCode::CONFLICT {
            return Ok(Refresh::AlreadyFresh);
        }
        success(resp, what)?;
        Ok(Refresh::Requested)
    }

    fn verify_webhook(
        &self,
        path: &str,
        headers: &HashMap<String, String>,
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
            .map_err(|e| ProviderError::Other(gripsou_core::logs::error_chain(&e)))?;
        mac.update(format!("POST.{path}.{date}.{body_str}").as_bytes());
        let expected = STANDARD.encode(mac.finalize().into_bytes());

        // Compare decoded bytes; timing leakage is negligible (HMAC over unknown secret).
        let given_bytes = STANDARD.decode(given).unwrap_or_default();
        let expected_bytes = STANDARD.decode(&expected).unwrap_or_default();
        if given_bytes.is_empty() || given_bytes != expected_bytes {
            return Err(ProviderError::Other("bad webhook signature".into()));
        }

        let env: model::WebhookEnvelope = serde_json::from_slice(body)
            .map_err(|e| ProviderError::Other(crate::json_decode_error("webhook", &e)))?;
        Ok(env
            .connection
            .map(|c| gripsou_core::provider::WebhookSignal {
                provider_connection_id: c.id.to_string(),
            }))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn from_config_needs_the_three_fields_and_builds_the_redirect() {
        let ctx = |url: &str| Context {
            public_url: url.into(),
        };
        let mut c = ProviderConfig::default();
        c.set("powens", "client_id", Some("id".into()));
        c.set("powens", "domain", Some("x.biapi.pro".into()));
        assert!(PowensProvider::from_config(&c, &ctx("https://g.example")).is_none());
        c.set("powens", "client_secret", Some("s".into()));
        let p = PowensProvider::from_config(&c, &ctx("https://g.example/")).unwrap();
        assert_eq!(p.redirect_uri, "https://g.example/connections/callback");
        assert_eq!(p.origin, "https://x.biapi.pro");
        let meta = serde_json::json!({ "external_connection_id": "7" });
        assert_eq!(p.refresh_mode(&meta), RefreshMode::Direct);
        c.set("powens", "webhook_secret", Some("w".into()));
        let p = PowensProvider::from_config(&c, &ctx("https://g.example")).unwrap();
        assert_eq!(p.refresh_mode(&meta), RefreshMode::Webhook);
        assert_eq!(
            p.refresh_mode(&serde_json::json!({ "external_connection_id": "" })),
            RefreshMode::Direct
        );
    }

    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

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
            .complete_connect(&params(&[
                ("code", "exchange-code-123"),
                ("connection_id", "99"),
            ]))
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
        assert!(
            p.complete_connect(&params(&[("no_code_here", "x")]))
                .await
                .is_err()
        );
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
        assert!(
            p.complete_connect(&params(&[("code", "bad")]))
                .await
                .is_err()
        );
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
        let out = p
            .complete_connect(&params(&[("code", "exchange-code-123")]))
            .await
            .unwrap();
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
        let mut h = HashMap::new();
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
        let mut h = HashMap::new();
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
        let mut h = HashMap::new();
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
            .and(query_param("expand", "connector,sources"))
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
        assert_eq!(
            p.request_refresh(&creds, &meta).await.unwrap(),
            Refresh::Requested
        );
    }
}
