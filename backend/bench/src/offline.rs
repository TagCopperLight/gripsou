use gripsou_core::{
    dto::{InstrumentRef, PricePoint},
    provider::{PriceProvider, ProviderError},
};
pub struct FreshOnly;
#[async_trait::async_trait]
impl PriceProvider for FreshOnly {
    fn key(&self) -> &str {
        "benchmark"
    }
    fn supports(&self, _: &InstrumentRef) -> bool {
        true
    }
    async fn resolve_symbol(&self, _: &InstrumentRef) -> Result<Option<String>, ProviderError> {
        panic!("fresh price path resolved a symbol")
    }
    async fn fetch_prices(
        &self,
        _: &str,
        _: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<Vec<PricePoint>, ProviderError> {
        panic!("fresh price path fetched prices")
    }
}
