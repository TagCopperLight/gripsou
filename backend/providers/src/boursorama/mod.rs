pub(crate) mod map;

use async_trait::async_trait;
use gripsou_core::dto::{Composition, InstrumentRef};
use gripsou_core::provider::{CompositionProvider, ProviderError};

use self::map::{bare_ticker, parse_amchart_data, symbol_from_location};

const LIVE_BASE: &str = "https://www.boursorama.com";
// Boursorama serves 403 to the default reqwest UA.
const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

pub struct BoursoramaCompositionProvider {
    base_url: String,
    /// Follows redirects — for the composition page (which 301s to add a slash).
    client: reqwest::Client,
    /// Does NOT follow redirects — so we can read the search's 302 `Location`,
    /// which points at `/cours/<symbol>/` for an exact ticker match.
    no_redirect: reqwest::Client,
}

impl BoursoramaCompositionProvider {
    pub fn new(base_url: String) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(UA)
            .build()
            .expect("reqwest client builds");
        let no_redirect = reqwest::Client::builder()
            .user_agent(UA)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("reqwest client builds");
        Self {
            base_url,
            client,
            no_redirect,
        }
    }

    pub fn new_default() -> Self {
        Self::new(LIVE_BASE.to_string())
    }
}

#[async_trait]
impl CompositionProvider for BoursoramaCompositionProvider {
    fn key(&self) -> &str {
        "boursorama"
    }

    async fn resolve_symbol(
        &self,
        instrument: &InstrumentRef,
    ) -> Result<Option<String>, ProviderError> {
        let query = instrument
            .symbol
            .as_deref()
            .or(instrument.isin.as_deref())
            .ok_or_else(|| ProviderError::Other("instrument has no symbol or isin".into()))?;
        let bare = bare_ticker(query);
        let url = format!(
            "{}/recherche/?query={}",
            self.base_url,
            urlencoding::encode(&bare)
        );
        let resp = self
            .no_redirect
            .get(&url)
            .send()
            .await
            .map_err(|e| ProviderError::Other(gripsou_core::logs::error_chain(&e)))?;

        // An exact ticker 302-redirects to the security page. A results page
        // (2xx) or a 404 means no single security: a real "not found". Anything
        // else (403/429 block page, 5xx) is Boursorama being unavailable, an
        // error, so the instrument is retried next sync instead of marked "none".
        let status = resp.status();
        if !status.is_redirection() {
            if status.is_success() || status == reqwest::StatusCode::NOT_FOUND {
                return Ok(None);
            }
            return Err(ProviderError::Other(format!(
                "boursorama search failed: {status}"
            )));
        }
        let location = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok());
        Ok(location.and_then(symbol_from_location))
    }

    async fn fetch_composition(&self, symbol: &str) -> Result<Composition, ProviderError> {
        let url = format!(
            "{}/bourse/trackers/cours/composition/{}/",
            self.base_url, symbol
        );
        let html = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ProviderError::Other(gripsou_core::logs::error_chain(&e)))?
            .error_for_status()
            .map_err(|e| ProviderError::Other(gripsou_core::logs::error_chain(&e)))?
            .text()
            .await
            .map_err(|e| ProviderError::Other(gripsou_core::logs::error_chain(&e)))?;

        Ok(Composition {
            countries: parse_amchart_data(&html, "regional").map_err(ProviderError::Other)?,
            sectors: parse_amchart_data(&html, "sector").map_err(ProviderError::Other)?,
        })
    }
}
