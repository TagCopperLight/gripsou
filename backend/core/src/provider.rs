use async_trait::async_trait;

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
    async fn sync(&self) -> Result<SyncResult, ProviderError>;
}

#[async_trait]
pub trait PriceProvider: Send + Sync {
    fn key(&self) -> &str;

    async fn supports(&self, instrument: &InstrumentRef) -> bool;

    async fn fetch_prices(
        &self,
        instrument: &InstrumentRef,
    ) -> Result<Vec<PricePoint>, ProviderError>;
}
