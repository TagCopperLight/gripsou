pub(crate) mod map;
pub(crate) mod search;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use gripsou_core::dto::{InstrumentRef, PricePoint};
use gripsou_core::provider::{PriceProvider, ProviderError};
use time::OffsetDateTime;
use yahoo_finance_api::YahooConnector;

use self::map::map_points;
use self::search::{Candidate, select_symbol};

pub struct YahooPriceProvider {
    connector: YahooConnector,
    /// The pivot currency FX rates are quoted against (see migration 0010).
    pivot: String,
}

impl YahooPriceProvider {
    pub fn new(pivot: String) -> Result<Self, ProviderError> {
        let connector = YahooConnector::new().map_err(|e| ProviderError::Other(e.to_string()))?;
        Ok(Self { connector, pivot })
    }
}

#[async_trait]
impl PriceProvider for YahooPriceProvider {
    fn key(&self) -> &str {
        "yahoo"
    }

    fn supports(&self, instrument: &InstrumentRef) -> bool {
        is_supported(instrument, &self.pivot)
    }

    async fn resolve_symbol(
        &self,
        instrument: &InstrumentRef,
    ) -> Result<Option<String>, ProviderError> {
        // An FX pair is deterministic — no search round trip needed.
        if instrument.kind == "cash" {
            return Ok(Some(fx_symbol(&instrument.currency, &self.pivot)));
        }

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

/// Yahoo's ticker for "one unit of `currency`, priced in `pivot`".
pub(crate) fn fx_symbol(currency: &str, pivot: &str) -> String {
    format!("{currency}{pivot}=X")
}

/// A well-formed ISO 4217 code. Anything else (a provider's lowercase `"usd"`,
/// a free-text label, an injection attempt) must never reach `fx_symbol` and so
/// a live Yahoo URL.
fn is_iso_currency(code: &str) -> bool {
    code.len() == 3 && code.bytes().all(|b| b.is_ascii_uppercase())
}

/// Eligible if it is a foreign cash instrument (its FX pair), or a non-crypto
/// security we have an identifier for. Cash in the pivot needs no rate (it is 1
/// by definition) and crypto has no clean ISIN→Yahoo path yet.
pub(crate) fn is_supported(instrument: &InstrumentRef, pivot: &str) -> bool {
    if instrument.kind == "cash" {
        return is_iso_currency(&instrument.currency) && instrument.currency != pivot;
    }
    instrument.kind != "crypto" && (instrument.isin.is_some() || instrument.symbol.is_some())
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

    fn cash(currency: &str) -> InstrumentRef {
        InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: currency.into(),
            currency: currency.into(),
        }
    }

    #[test]
    fn supports_equity_with_isin() {
        assert!(is_supported(
            &iref("equity", Some("FR0000121014"), None),
            "EUR"
        ));
    }

    #[test]
    fn supports_etf_with_symbol_only() {
        assert!(is_supported(&iref("etf", None, Some("CSPX.L")), "EUR"));
    }

    #[test]
    fn rejects_cash_crypto_and_idless() {
        assert!(!is_supported(&cash("EUR"), "EUR"));
        assert!(!is_supported(&iref("crypto", Some("X"), None), "EUR"));
        assert!(!is_supported(&iref("equity", None, None), "EUR"));
    }

    #[test]
    fn supports_foreign_cash_but_not_the_pivot() {
        assert!(is_supported(&cash("CNY"), "EUR"));
        assert!(!is_supported(&cash("EUR"), "EUR"), "no EUREUR=X exists");
        assert!(
            !is_supported(&cash(""), "EUR"),
            "an unlabelled currency is unfetchable"
        );
    }

    #[test]
    fn builds_the_fx_pair_symbol() {
        assert_eq!(fx_symbol("CNY", "EUR"), "CNYEUR=X");
        assert_eq!(fx_symbol("USD", "EUR"), "USDEUR=X");
    }
}
