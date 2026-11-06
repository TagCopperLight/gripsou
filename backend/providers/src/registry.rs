//! Every provider this build knows, and the adapters a saved config builds.
//! Each adapter declares itself once (its `KIND` or `ABOUT`); these lists are
//! the only catalog, so adding a provider touches no schema. The admin turns
//! account providers on in `app_settings.enabled_providers`.

use std::collections::HashMap;
use std::sync::Arc;

use gripsou_core::categorize::{CategorizeError, Categorizer};
use gripsou_core::provider::{AccountProvider, CompositionProvider, PriceProvider, ProviderError};
use gripsou_core::provider_config::{ConfigField, ProviderConfig};

use crate::brandfetch::Logos;
use crate::{boursorama, brandfetch, jev, powens, yahoo};

/// What a provider shows in Settings → Server → API keys.
pub struct About {
    pub key: &'static str,
    pub display_name: &'static str,
    /// Empty for a provider that needs no key.
    pub fields: &'static [ConfigField],
}

/// What the adapters need besides their keys.
#[derive(Debug, Clone)]
pub struct Context {
    /// `PUBLIC_URL`, the address gripsou is opened at.
    pub public_url: String,
}

/// An account provider: what the admin and the connect page show, and how its
/// adapter is built.
pub struct AccountKind {
    pub about: About,
    /// English only, shown as is.
    pub description: &'static str,
    /// `None` when its keys aren't saved: the provider is then listed but has
    /// no adapter, and its connections fail with "no adapter".
    pub build: fn(&ProviderConfig, &Context) -> Option<Arc<dyn AccountProvider>>,
    /// The website of an institution (`connection.institution_key`), for its logo.
    pub institution_domain: fn(&str) -> Option<&'static str>,
}

/// A categorisation provider for the budget AI.
pub struct CategorizerKind {
    pub about: About,
    pub default_model: &'static str,
    /// Whether its key is saved (blank counts as unset).
    pub configured: fn(&ProviderConfig) -> bool,
    pub build: fn(&ProviderConfig, &str) -> Option<Box<dyn Categorizer>>,
}

pub const ACCOUNTS: &[&AccountKind] = &[&powens::KIND];

pub const CATEGORIZERS: &[&CategorizerKind] = &[&jev::KIND];

pub fn account_kind(key: &str) -> Option<&'static AccountKind> {
    ACCOUNTS.iter().copied().find(|k| k.about.key == key)
}

pub fn categorizer_kind(key: &str) -> Option<&'static CategorizerKind> {
    CATEGORIZERS.iter().copied().find(|k| k.about.key == key)
}

/// Every provider with keys, in display order: the only names the API
/// accepts a key for.
pub fn keyed() -> impl Iterator<Item = &'static About> {
    ACCOUNTS
        .iter()
        .map(|k| &k.about)
        .chain(CATEGORIZERS.iter().map(|k| &k.about))
        .chain([&brandfetch::ABOUT])
        .filter(|a| !a.fields.is_empty())
}

pub fn keyed_provider(key: &str) -> Option<&'static About> {
    keyed().find(|a| a.key == key)
}

/// The price adapters. `pivot` is the currency FX rates are stored in.
pub fn price_providers(pivot: &str) -> Result<Vec<Box<dyn PriceProvider>>, ProviderError> {
    Ok(vec![Box::new(yahoo::YahooPriceProvider::new(
        pivot.to_string(),
    )?)])
}

pub fn composition_provider() -> Box<dyn CompositionProvider> {
    Box::new(boursorama::BoursoramaCompositionProvider::new_default())
}

/// The adapters one saved config builds. Replaced as a whole when keys are
/// saved; a sync keeps the adapter it started with.
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

    /// The same keys, with `accounts` as the only account adapters.
    pub fn with_accounts(self, accounts: HashMap<String, Arc<dyn AccountProvider>>) -> Self {
        Self { accounts, ..self }
    }

    pub fn config(&self) -> &ProviderConfig {
        &self.config
    }

    pub fn account(&self, key: &str) -> Option<Arc<dyn AccountProvider>> {
        self.accounts.get(key).cloned()
    }

    /// Whether the connection's provider can open its management page.
    pub fn supports_manage(&self, key: &str) -> bool {
        self.accounts.get(key).is_some_and(|p| p.supports_manage())
    }

    /// Categorisers whose key is saved: the admin dropdown's options.
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

    /// The models a categoriser offers, asked of the provider itself. `None`
    /// when the provider is unknown or its key is not saved.
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
