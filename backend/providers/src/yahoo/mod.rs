pub(crate) mod map;
pub(crate) mod search;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use gripsou_core::dto::{InstrumentRef, PricePoint};
use gripsou_core::provider::{PriceProvider, ProviderError};
use time::OffsetDateTime;
use yahoo_finance_api::YahooConnector;

use self::map::map_points;
use self::search::{select_symbol, Candidate};

pub struct YahooPriceProvider {
    connector: YahooConnector,
}

impl YahooPriceProvider {
    pub fn new() -> Result<Self, ProviderError> {
        let connector =
            YahooConnector::new().map_err(|e| ProviderError::Other(e.to_string()))?;
        Ok(Self { connector })
    }
}

#[async_trait]
impl PriceProvider for YahooPriceProvider {
    fn key(&self) -> &str {
        "yahoo"
    }

    fn supports(&self, instrument: &InstrumentRef) -> bool {
        is_supported(instrument)
    }

    async fn resolve_symbol(
        &self,
        instrument: &InstrumentRef,
    ) -> Result<Option<String>, ProviderError> {
        // Prefer ISIN for the search query; fall back to a provider symbol.
        let query = instrument
            .isin
            .as_deref()
            .or(instrument.symbol.as_deref())
            .ok_or_else(|| ProviderError::Other("instrument has no isin or symbol".into()))?;

        let res = self
            .connector
            .search_ticker(query)
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        // Distil the crate's result rows into our own minimal type, then apply
        // the pure selection. NOTE: field names (`symbol`, `quote_type`) are the
        // crate's; if they differ in 4.1.x the compiler will say so — adjust here.
        let candidates: Vec<Candidate> = res
            .quotes
            .iter()
            .map(|q| Candidate {
                symbol: q.symbol.clone(),
                quote_type: q.quote_type.clone(),
            })
            .collect();

        Ok(select_symbol(&candidates))
    }

    async fn fetch_prices(
        &self,
        symbol: &str,
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<PricePoint>, ProviderError> {
        let start_ts = since.map(|ts| ts.timestamp()).unwrap_or(0);
        let start = OffsetDateTime::from_unix_timestamp(start_ts)
            .map_err(|e| ProviderError::Other(e.to_string()))?;
        let end = OffsetDateTime::now_utc();
        
        let resp = self
            .connector
            .get_quote_history(symbol, start, end)
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        // Report Yahoo's own currency for the listing. If it's missing we do NOT
        // guess (an empty string won't match any instrument currency, so the
        // orchestrator's currency guard drops these points rather than mislabel
        // a foreign-currency price as the base currency).
        let currency = resp
            .metadata()
            .ok()
            .and_then(|m| m.currency)
            .unwrap_or_default();
        let rows: Vec<(i64, f64)> = resp
            .quotes()
            .map_err(|e| ProviderError::Other(e.to_string()))?
            .iter()
            .map(|q| (q.timestamp, q.close))
            .collect();

        Ok(map_points(&rows, &currency))
    }
}

/// Eligible if it is a non-cash instrument we have an identifier for. Cash is
/// valued at 1 (handled elsewhere); crypto has no clean ISIN→Yahoo path yet.
pub(crate) fn is_supported(instrument: &InstrumentRef) -> bool {
    instrument.kind != "cash"
        && instrument.kind != "crypto"
        && (instrument.isin.is_some() || instrument.symbol.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iref(kind: &str, isin: Option<&str>, symbol: Option<&str>) -> InstrumentRef {
        InstrumentRef {
            kind: kind.into(),
            symbol: symbol.map(Into::into),
            isin: isin.map(Into::into),
            name: "X".into(),
            currency: "EUR".into(),
        }
    }

    #[test]
    fn supports_equity_with_isin() {
        assert!(is_supported(&iref("equity", Some("FR0000121014"), None)));
    }

    #[test]
    fn supports_etf_with_symbol_only() {
        assert!(is_supported(&iref("etf", None, Some("CSPX.L"))));
    }

    #[test]
    fn rejects_cash_crypto_and_idless() {
        assert!(!is_supported(&iref("cash", None, None)));
        assert!(!is_supported(&iref("crypto", Some("X"), None)));
        assert!(!is_supported(&iref("equity", None, None)));
    }
}