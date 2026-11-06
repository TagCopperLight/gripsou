//! Brandfetch logo URLs for institutions (banks/brokers) and instruments,
//! built at read time so a change of the Brandfetch client id reaches every logo.

use gripsou_core::provider_config::{ConfigField, ProviderConfig};

use crate::registry::{About, account_kind};

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

    /// The Brandfetch parameters every logo uses: `/fallback/404/theme/light`
    /// and `?c={client id}` when one is saved.
    fn url(&self, path: &str) -> String {
        let base = format!("https://cdn.brandfetch.io/{path}/fallback/404/theme/light");
        match &self.client_id {
            Some(c) => format!("{base}?c={c}"),
            None => base,
        }
    }

    /// An institution's logo by its provider's key for it, or `None` when the
    /// key is absent or its provider maps it to no website.
    pub fn institution(&self, provider_key: &str, institution_key: Option<&str>) -> Option<String> {
        let key = institution_key?;
        let Some(domain) = account_kind(provider_key).and_then(|k| (k.institution_domain)(key))
        else {
            tracing::debug!(
                provider = provider_key,
                institution_key = key,
                "no logo domain mapped"
            );
            return None;
        };
        Some(self.url(domain))
    }

    /// An instrument's logo: by ISIN, else ticker. `None` for cash or when
    /// there is nothing to look it up by.
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
