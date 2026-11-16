use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::dto::{Composition, InstrumentRef, PricePoint, SyncResult};

#[derive(Debug, Clone, Default)]
pub struct ConnectInit {
    pub redirect_url: Option<String>,
}

/// The `provider_meta` key holding the provider-native connection id, matched by a webhook's [`WebhookSignal`].
pub const EXTERNAL_CONNECTION_ID: &str = "external_connection_id";

#[derive(Debug, Clone, Default)]
pub struct CompleteConnect {
    pub credentials: serde_json::Value,
    /// Provider-native ids for correlation. A webhook's [`WebhookSignal`] is matched on [`EXTERNAL_CONNECTION_ID`].
    pub provider_meta: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshMode {
    Direct,
    /// Ask the provider to refresh ([`AccountProvider::request_refresh`]) and fetch when its webhook says it is done.
    Webhook,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refresh {
    Requested,
    /// The provider holds the latest data already and sends no webhook.
    AlreadyFresh,
}

#[derive(Debug, Clone)]
pub struct WebhookSignal {
    pub provider_connection_id: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("provider not implemented")]
    NotImplemented,
    #[error("provider error: {0}")]
    Other(String),
}

#[async_trait]
pub trait AccountProvider: Send + Sync {
    async fn connect(&self) -> Result<ConnectInit, ProviderError>;

    async fn complete_connect(
        &self,
        params: &HashMap<String, String>,
    ) -> Result<CompleteConnect, ProviderError>;

    async fn sync(&self, credentials: &serde_json::Value) -> Result<SyncResult, ProviderError>;

    fn supports_manage(&self) -> bool {
        false
    }

    async fn manage(
        &self,
        _credentials: &serde_json::Value,
        _provider_meta: &serde_json::Value,
    ) -> Result<ConnectInit, ProviderError> {
        Err(ProviderError::NotImplemented)
    }

    fn refresh_mode(&self, _provider_meta: &serde_json::Value) -> RefreshMode {
        RefreshMode::Direct
    }

    /// Called before awaiting the webhook.
    async fn request_refresh(
        &self,
        _credentials: &serde_json::Value,
        _provider_meta: &serde_json::Value,
    ) -> Result<Refresh, ProviderError> {
        Err(ProviderError::NotImplemented)
    }

    /// `path` is the request path used in the signature. `Err` rejects (401), `Ok(None)` is valid but ignored,
    /// `Ok(Some(_))` means a connection finished syncing.
    fn verify_webhook(
        &self,
        _path: &str,
        _headers: &HashMap<String, String>,
        _body: &[u8],
    ) -> Result<Option<WebhookSignal>, ProviderError> {
        Err(ProviderError::NotImplemented)
    }
}

#[async_trait]
pub trait PriceProvider: Send + Sync {
    fn key(&self) -> &str;

    fn supports(&self, instrument: &InstrumentRef) -> bool;

    /// `Ok(None)` means no match, distinct from a transient `Err`.
    async fn resolve_symbol(
        &self,
        instrument: &InstrumentRef,
    ) -> Result<Option<String>, ProviderError>;

    /// `since = None` is a full backfill.
    async fn fetch_prices(
        &self,
        symbol: &str,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<PricePoint>, ProviderError>;
}

/// The trait lives in `core` to keep the provider→core dependency direction.
#[async_trait]
pub trait CompositionProvider: Send + Sync {
    fn key(&self) -> &str;

    /// `Ok(None)` means not a tracker or no composition page.
    async fn resolve_symbol(
        &self,
        instrument: &InstrumentRef,
    ) -> Result<Option<String>, ProviderError>;

    async fn fetch_composition(&self, symbol: &str) -> Result<Composition, ProviderError>;
}
