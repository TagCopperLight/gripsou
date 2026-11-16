//! Every provider this build knows. Each adapter declares itself once (`KIND` or `ABOUT`); these
//! lists are the only catalog, so adding a provider touches no schema.

use std::collections::HashMap;
use std::sync::Arc;

use gripsou_core::categorize::{CategorizeError, Categorizer};
use gripsou_core::provider::{AccountProvider, CompositionProvider, PriceProvider, ProviderError};
use gripsou_core::provider_config::{ConfigField, ProviderConfig};

use crate::brandfetch::Logos;
use crate::{boursorama, brandfetch, jev, powens, yahoo};

pub struct About {
    pub key: &'static str,
    pub display_name: &'static str,
    pub fields: &'static [ConfigField],
}

#[derive(Debug, Clone)]
pub struct Context {
    pub public_url: String,
}

impl Context {
    /// The address a bank provider's console must allow as the return URL.
    pub fn callback_url(&self) -> String {
        format!(
            "{}/connections/callback",
            self.public_url.trim_end_matches('/')
        )
    }
}

pub struct AccountKind {
    pub about: About,
    pub description: &'static str,
    /// `None` when its keys aren't saved: the provider is listed but its connections fail with "no adapter".
    pub build: fn(&ProviderConfig, &Context) -> Option<Arc<dyn AccountProvider>>,
    pub institution_domain: fn(&str) -> Option<&'static str>,
}

pub struct CategorizerKind {
    pub about: About,
    pub default_model: &'static str,
    pub configured: fn(&ProviderConfig) -> bool,
    pub build: fn(&ProviderConfig, &str) -> Option<Box<dyn Categorizer>>,
}

pub const ACCOUNTS: &[&AccountKind] = &[&powens::KIND];

pub const CATEGORIZERS: &[&CategorizerKind] = &[&jev::KIND];

pub fn account_kind(key: &str) -> Option<&'static AccountKind> {
    ACCOUNTS.iter().copied().find(|k| k.about.key == key)
}

pub fn institution_domain(provider_key: &str, institution_key: &str) -> Option<&'static str> {
    account_kind(provider_key).and_then(|k| (k.institution_domain)(institution_key))
}

pub fn categorizer_kind(key: &str) -> Option<&'static CategorizerKind> {
    CATEGORIZERS.iter().copied().find(|k| k.about.key == key)
}

#[derive(Clone, Copy)]
pub enum Keyed {
    Bank(&'static AccountKind),
    Categorize(&'static CategorizerKind),
    Logos(&'static About),
}

impl Keyed {
    pub fn about(self) -> &'static About {
        match self {
            Keyed::Bank(k) => &k.about,
            Keyed::Categorize(k) => &k.about,
            Keyed::Logos(a) => a,
        }
    }
}

/// Every provider with keys, in display order: the only names the API accepts a key for.
pub fn keyed() -> impl Iterator<Item = Keyed> {
    ACCOUNTS
        .iter()
        .map(|k| Keyed::Bank(k))
        .chain(CATEGORIZERS.iter().map(|k| Keyed::Categorize(k)))
        .chain([Keyed::Logos(&brandfetch::ABOUT)])
        .filter(|k| !k.about().fields.is_empty())
}

pub fn keyed_provider(key: &str) -> Option<Keyed> {
    keyed().find(|k| k.about().key == key)
}

pub fn price_providers(pivot: &str) -> Result<Vec<Box<dyn PriceProvider>>, ProviderError> {
    Ok(vec![Box::new(yahoo::YahooPriceProvider::new(
        pivot.to_string(),
    )?)])
}

pub fn composition_provider() -> Box<dyn CompositionProvider> {
    Box::new(boursorama::BoursoramaCompositionProvider::new_default())
}

/// The adapters one saved config builds. A sync keeps the adapter it started with.
pub struct Providers {
    config: ProviderConfig,
    accounts: HashMap<String, Arc<dyn AccountProvider>>,
    logos: Logos,
}

impl Providers {
    pub fn build(config: ProviderConfig, ctx: &Context) -> Self {
        let accounts = ACCOUNTS
            .iter()
            .filter_map(|k| Some((k.about.key.to_string(), (k.build)(&config, ctx)?)))
            .collect();
        Self {
            logos: Logos::new(&config),
            accounts,
            config,
        }
    }

    #[cfg(feature = "test-util")]
    pub fn with_accounts(self, accounts: HashMap<String, Arc<dyn AccountProvider>>) -> Self {
        Self { accounts, ..self }
    }

    pub fn config(&self) -> &ProviderConfig {
        &self.config
    }

    pub fn account(&self, key: &str) -> Option<Arc<dyn AccountProvider>> {
        self.accounts.get(key).cloned()
    }

    pub fn supports_manage(&self, key: &str) -> bool {
        self.accounts.get(key).is_some_and(|p| p.supports_manage())
    }

    pub fn available_categorizers(&self) -> Vec<&'static str> {
        CATEGORIZERS
            .iter()
            .filter(|k| (k.configured)(&self.config))
            .map(|k| k.about.key)
            .collect()
    }

    pub fn categorizer(&self, key: &str, model: &str) -> Option<Box<dyn Categorizer>> {
        (categorizer_kind(key)?.build)(&self.config, model)
    }

    pub async fn categorizer_models(
        &self,
        key: &str,
    ) -> Option<Result<Vec<String>, CategorizeError>> {
        let kind = categorizer_kind(key)?;
        let c = (kind.build)(&self.config, kind.default_model)?;
        Some(c.models().await)
    }

    pub fn logos(&self) -> &Logos {
        &self.logos
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_keys_build_the_adapters() {
        let ctx = Context {
            public_url: "https://g.example".into(),
        };
        let p = Providers::build(ProviderConfig::default(), &ctx);
        assert!(p.account("powens").is_none());
        assert!(p.available_categorizers().is_empty());

        let mut c = ProviderConfig::default();
        for (f, v) in [
            ("client_id", "id"),
            ("domain", "x.biapi.pro"),
            ("client_secret", "s"),
        ] {
            c.set("powens", f, Some(v.into()));
        }
        c.set("jev", "api_key", Some("k".into()));
        let p = Providers::build(c, &ctx);
        assert!(p.account("powens").is_some());
        assert_eq!(p.available_categorizers(), ["jev"]);
        assert!(p.categorizer("jev", "m").is_some());
    }
}
