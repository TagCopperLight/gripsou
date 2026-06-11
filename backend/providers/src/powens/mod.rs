//! Powens account provider (banks, PEA, brokerage).
//!
//! This slice implements the pure mapping layer (`model` + `map`). The HTTP
//! client, authentication, and the connect/webview flow land in a later slice,
//! so the `AccountProvider` trait methods remain unimplemented for now.

pub mod map;
pub mod model;

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
