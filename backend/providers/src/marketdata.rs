//! Market-data price provider. Stub — wiring lands later.

use async_trait::async_trait;
use gripsou_core::dto::{InstrumentRef, PricePoint};
use gripsou_core::provider::{PriceProvider, ProviderError};

pub struct MarketDataProvider;

#[async_trait]
impl PriceProvider for MarketDataProvider {
    fn key(&self) -> &str {
        "marketdata"
    }

    async fn supports(&self, _instrument: &InstrumentRef) -> bool {
        false
    }

    async fn fetch_prices(
        &self,
        _instrument: &InstrumentRef,
    ) -> Result<Vec<PricePoint>, ProviderError> {
        Err(ProviderError::NotImplemented)
    }
}
