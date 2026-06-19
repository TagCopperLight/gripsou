use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::dto::{InstrumentRef, PricePoint, SyncResult};

#[derive(Debug, Clone, Default)]
pub struct ConnectInit {
    pub redirect_url: Option<String>,
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
    fn key(&self) -> &str;

    /// Begin a connection; may return a redirect/webview URL.
    async fn connect(&self) -> Result<ConnectInit, ProviderError>;

    /// Finish an external auth round-trip, yielding credentials to persist.
    async fn complete_connect(&self, callback: &str) -> Result<serde_json::Value, ProviderError>;

    /// Pull canonical accounts / holdings / transactions for a connection.
    async fn sync(&self, credentials: &serde_json::Value) -> Result<SyncResult, ProviderError>;
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
