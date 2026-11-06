use std::sync::Arc;
use std::time::Duration;

#[cfg(any(test, feature = "test-util"))]
use std::collections::HashMap;

use gripsou_core::crypto::EncryptionKey;
use gripsou_core::db::Db;
use gripsou_core::error::CoreError;
use gripsou_core::provider::{AccountProvider, CompositionProvider, PriceProvider, ProviderError};
use gripsou_core::provider_config::ProviderConfig;
use gripsou_providers::registry::{self, AccountKind, Context, Providers};

/// A sync still going after this is stopped and recorded as failed: a provider
/// that never answers must not hold the connection's lock. Comfortably longer
/// than the slowest observed sync.
const SYNC_TIME_LIMIT: Duration = Duration::from_secs(30 * 60);

/// The key and the adapters every job uses: built at startup and shared
/// (tests build their own, with fakes).
pub struct Deps {
    pub key: EncryptionKey,
    context: Context,
    /// Replaced as a whole by [`Deps::apply_config`]; read through [`Deps::providers`].
    providers: std::sync::RwLock<Arc<Providers>>,
    /// The currency FX rates are stored in (`app_settings.base_currency`).
    pub pivot: String,
    pub prices: Vec<Box<dyn PriceProvider>>,
    pub composition: Box<dyn CompositionProvider>,
    /// How long a sync may run before it is stopped.
    pub time_limit: Duration,
}

impl Deps {
    /// The adapters the saved keys configure, with the stored pivot. Fails
    /// when the settings can't be read: every figure depends on the pivot.
    pub async fn load(db: &Db, key: EncryptionKey, public_url: String) -> Result<Deps, String> {
        use gripsou_core::logs::error_chain;
        let pivot = gripsou_core::repo::settings::base_currency(db)
            .await
            .map_err(|e| format!("base currency unreadable: {}", error_chain(&e)))?;
        let loaded = gripsou_core::repo::provider_config::load(db, &key)
            .await
            .map_err(|e| format!("provider config unreadable: {}", error_chain(&e)))?;
        for provider in &loaded.unreadable {
            tracing::error!(provider = %provider, "provider config unreadable");
        }
        Deps::build(key, pivot, public_url, loaded.config)
            .map_err(|e| format!("price provider unavailable: {}", error_chain(&e)))
    }

    pub fn build(
        key: EncryptionKey,
        pivot: String,
        public_url: String,
        config: ProviderConfig,
    ) -> Result<Deps, ProviderError> {
        let context = Context { public_url };
        Ok(Deps {
            key,
            providers: std::sync::RwLock::new(Arc::new(Providers::build(config, &context))),
            context,
            prices: registry::price_providers(&pivot)?,
            pivot,
            composition: registry::composition_provider(),
            time_limit: SYNC_TIME_LIMIT,
        })
    }

    /// The adapters in effect. A sync keeps the ones it started with.
    pub fn providers(&self) -> Arc<Providers> {
        self.providers
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Puts saved keys in effect: every adapter built from them is rebuilt.
    pub fn apply_config(&self, config: ProviderConfig) {
        let built = Arc::new(Providers::build(config, &self.context));
        *self.providers.write().unwrap_or_else(|e| e.into_inner()) = built;
    }

    /// Tests: replaces the account adapters with fakes.
    #[cfg(any(test, feature = "test-util"))]
    pub fn set_accounts(&self, accounts: HashMap<String, Arc<dyn AccountProvider>>) {
        let mut slot = self.providers.write().unwrap_or_else(|e| e.into_inner());
        let current = Providers::build(slot.config().clone(), &self.context);
        *slot = Arc::new(current.with_accounts(accounts));
    }

    pub(crate) fn account(&self, key: &str) -> Option<Arc<dyn AccountProvider>> {
        self.providers().account(key)
    }
}

/// The account providers the admin turned on, in catalog order.
pub async fn enabled_providers(db: &Db) -> Result<Vec<&'static AccountKind>, CoreError> {
    let enabled = gripsou_core::repo::settings::enabled_providers(db).await?;
    Ok(registry::ACCOUNTS
        .iter()
        .copied()
        .filter(|k| enabled.iter().any(|e| e == k.about.key))
        .collect())
}

/// `key` when it names an account provider the admin turned on.
pub async fn enabled_provider(
    db: &Db,
    key: &str,
) -> Result<Option<&'static AccountKind>, CoreError> {
    Ok(enabled_providers(db)
        .await?
        .into_iter()
        .find(|k| k.about.key == key))
}
