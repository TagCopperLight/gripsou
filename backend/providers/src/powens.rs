//! Powens account provider (banks, PEA, brokerage). Stub — wiring lands later.

use async_trait::async_trait;
use gripsou_core::dto::SyncResult;
use gripsou_core::provider::{AccountProvider, ConnectInit, ProviderError};

pub struct PowensProvider;

#[async_trait]
impl AccountProvider for PowensProvider {
    fn key(&self) -> &str {
        "powens"
    }

    async fn connect(&self) -> Result<ConnectInit, ProviderError> {
        Err(ProviderError::NotImplemented)
    }

    async fn complete_connect(&self, _callback: &str) -> Result<serde_json::Value, ProviderError> {
        Err(ProviderError::NotImplemented)
    }

    async fn sync(&self) -> Result<SyncResult, ProviderError> {
        Err(ProviderError::NotImplemented)
    }
}
