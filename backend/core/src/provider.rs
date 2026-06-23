use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::dto::{Composition, InstrumentRef, PricePoint, SyncResult};

#[derive(Debug, Clone, Default)]
pub struct ConnectInit {
    pub redirect_url: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct CompleteConnect {
    /// Secrets to encrypt + store in connection.credentials.
    pub credentials: serde_json::Value,
    /// Provider-native ids for correlation; stored in connection.provider_meta.
    pub provider_meta: serde_json::Value,
}

/// What a verified incoming webhook tells us: which provider-native connection
/// finished syncing. Correlated to our row via provider_meta.external_connection_id.
#[derive(Debug, Clone)]
pub struct WebhookSignal {
    pub provider_connection_id: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("provider not implemented")]
    NotImplemented,
    #[error("provider refresh conflict (already up to date)")]
    Conflict,
    #[error("provider error: {0}")]
    Other(String),
}

#[async_trait]
pub trait AccountProvider: Send + Sync {
    fn key(&self) -> &str;

    /// Begin a connection; may return a redirect/webview URL.
    async fn connect(&self) -> Result<ConnectInit, ProviderError>;

    /// Finish an external auth round-trip, yielding credentials to persist.
    async fn complete_connect(&self, callback: &str) -> Result<CompleteConnect, ProviderError>;

    /// Pull canonical accounts / holdings / transactions for a connection.
    async fn sync(&self, credentials: &serde_json::Value) -> Result<SyncResult, ProviderError>;

    /// True when this provider drives sync via webhooks (and is configured for it).
    fn webhooks_enabled(&self) -> bool {
        false
    }

    /// Ask the provider to force a fresh pull for one connection. Called before
    /// awaiting the webhook. `provider_meta` carries ids stored at connect time.
    async fn request_refresh(
        &self,
        _credentials: &serde_json::Value,
        _provider_meta: &serde_json::Value,
    ) -> Result<(), ProviderError> {
        Err(ProviderError::NotImplemented)
    }

    /// Verify + correlate an incoming webhook. `path` is the request path used in
    /// the signature. `Err` => reject (401). `Ok(None)` => valid but ignored
    /// event. `Ok(Some(_))` => a connection finished syncing; go full-fetch it.
    fn verify_webhook(
        &self,
        _path: &str,
        _headers: &std::collections::HashMap<String, String>,
        _body: &[u8],
    ) -> Result<Option<WebhookSignal>, ProviderError> {
        Err(ProviderError::NotImplemented)
    }
}

#[async_trait]
pub trait PriceProvider: Send + Sync {
    fn key(&self) -> &str;

    /// Cheap, local eligibility check — no network.
    fn supports(&self, instrument: &InstrumentRef) -> bool;

    /// Resolve a provider-native symbol for this instrument. `Ok(None)` means
    /// "no match found" (distinct from a transient `Err`).
    async fn resolve_symbol(
        &self,
        instrument: &InstrumentRef,
    ) -> Result<Option<String>, ProviderError>;

    /// Fetch daily price points for an already-resolved native symbol.
    /// `since = None` → full backfill; `since = Some(ts)` → points from `ts`.
    async fn fetch_prices(
        &self,
        symbol: &str,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<PricePoint>, ProviderError>;
}

/// Scrapes an ETF's country/sector breakdown. One implementation (Boursorama);
/// the trait lives in `core` to keep the provider→core dependency direction.
#[async_trait]
pub trait CompositionProvider: Send + Sync {
    fn key(&self) -> &str;

    /// Resolve a provider-native symbol for this instrument. `Ok(None)` means
    /// "not a tracker / no composition page" (distinct from a transient `Err`).
    async fn resolve_symbol(
        &self,
        instrument: &InstrumentRef,
    ) -> Result<Option<String>, ProviderError>;

    /// Fetch composition for an already-resolved native symbol.
    async fn fetch_composition(&self, symbol: &str) -> Result<Composition, ProviderError>;
}
