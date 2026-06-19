pub mod map;
pub mod model;

use async_trait::async_trait;
use gripsou_core::dto::SyncResult;
use gripsou_core::provider::{AccountProvider, ConnectInit, ProviderError};

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
        })
    }

    /// `path` may start with `/` or not; both are accepted.
    pub(crate) fn api_url(&self, path: &str) -> String {
        format!("{}/2.0/{}", self.origin, path.trim_start_matches('/'))
    }

    #[cfg(test)]
    pub(crate) fn for_test(base_url: &str) -> Self {
        Self {
            client_id: "test-client".into(),
            client_secret: "test-secret".into(),
            redirect_uri: "https://gripsou.test/connections/callback".into(),
            domain: "test.biapi.pro".into(),
            origin: base_url.to_string(),
            http: reqwest::Client::new(),
        }
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
    async fn complete_connect(&self, callback: &str) -> Result<serde_json::Value, ProviderError> {
        #[derive(serde::Deserialize)]
        struct TokenAccessResponse {
            access_token: String,
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

        Ok(serde_json::json!({ "auth_token": token_resp.access_token }))
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
                println!("Accounts decode error: {}\nRaw JSON: {}", e, accounts_text);
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
                println!(
                    "Investments decode error: {}\nRaw JSON: {}",
                    e, investments_text
                );
                return Err(ProviderError::Other(format!(
                    "investments decode error: {}",
                    e
                )));
            }
        };

        // TEMP DEBUG (remove): surface raw balances vs itemised values so we can
        // see whether Powens includes the liquidity sleeve in `balance`.
        for a in &accounts.accounts {
            let sec: rust_decimal::Decimal = investments
                .investments
                .iter()
                .filter(|i| i.id_account == a.id && !map::is_liquidity(i) && i.deleted.is_none())
                .filter_map(|i| i.valuation)
                .sum();
            let liq: rust_decimal::Decimal = investments
                .investments
                .iter()
                .filter(|i| i.id_account == a.id && map::is_liquidity(i) && i.deleted.is_none())
                .filter_map(|i| i.valuation)
                .sum();
            eprintln!(
                "[powens debug] acct id={} type={:?} balance={:?} securities_sum={} liquidity_sum={}",
                a.id, a.r#type, a.balance, sec, liq
            );
        }

        Ok(map::map_sync(&accounts.accounts, &investments.investments))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

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

        let p = PowensProvider::for_test(&server.uri());
        let creds = p.complete_connect("code=exchange-code-123").await.unwrap();
        assert_eq!(creds["auth_token"], "perm-abc");
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
}
