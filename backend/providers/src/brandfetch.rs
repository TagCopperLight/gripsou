//! Brandfetch logo URLs, built at read time so a change of the client id reaches every logo.

use gripsou_core::provider_config::{ConfigField, ProviderConfig};

use crate::registry::{About, institution_domain};

pub const ABOUT: About = About {
    key: "brandfetch",
    display_name: "Brandfetch",
    fields: &[ConfigField {
        key: "client_id",
        label: "Client ID",
        secret: false,
    }],
};

pub struct Logos {
    client_id: Option<String>,
}

impl Logos {
    pub fn new(config: &ProviderConfig) -> Self {
        Self {
            client_id: config.get(ABOUT.key, "client_id").map(str::to_string),
        }
    }

    fn url(&self, path: &str) -> String {
        let base = format!("https://cdn.brandfetch.io/{path}/fallback/404/theme/light");
        match &self.client_id {
            Some(c) => format!("{base}?c={c}"),
            None => base,
        }
    }

    pub fn institution(&self, provider_key: &str, institution_key: Option<&str>) -> Option<String> {
        institution_domain(provider_key, institution_key?).map(|d| self.url(d))
    }

    pub fn instrument(
        &self,
        kind: &str,
        isin: Option<&str>,
        symbol: Option<&str>,
    ) -> Option<String> {
        if kind == "cash" {
            return None;
        }
        let path = match (isin, symbol) {
            (Some(isin), _) => format!("isin/{isin}"),
            (None, Some(symbol)) => format!("ticker/{symbol}"),
            (None, None) => return None,
        };
        Some(self.url(&path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logos(client_id: Option<&str>) -> Logos {
        let mut c = ProviderConfig::default();
        c.set("brandfetch", "client_id", client_id.map(str::to_string));
        Logos::new(&c)
    }

    #[test]
    fn instrument_logo_prefers_isin_over_ticker() {
        let l = logos(None);
        assert_eq!(
            l.instrument("etf", Some("IE00B5BMR087"), Some("CSPX")),
            Some("https://cdn.brandfetch.io/isin/IE00B5BMR087/fallback/404/theme/light".into())
        );
        assert_eq!(
            l.instrument("equity", None, Some("AAPL")),
            Some("https://cdn.brandfetch.io/ticker/AAPL/fallback/404/theme/light".into())
        );
        assert_eq!(l.instrument("cash", None, Some("EUR")), None);
        assert_eq!(l.instrument("equity", None, None), None);
    }

    #[test]
    fn institution_logo_uses_its_providers_domain_and_the_client_id() {
        let l = logos(Some("cid"));
        assert_eq!(
            l.institution("powens", Some("07d76adf-ae35-5b38-aca8-67aafba13169")),
            Some("https://cdn.brandfetch.io/boursorama.com/fallback/404/theme/light?c=cid".into())
        );
        assert_eq!(l.institution("powens", None), None);
        assert_eq!(l.institution("powens", Some("not-a-real-key")), None);
        assert_eq!(
            l.institution("other", Some("07d76adf-ae35-5b38-aca8-67aafba13169")),
            None
        );
    }
}
