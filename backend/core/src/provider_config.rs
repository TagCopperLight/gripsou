//! The keys providers need (Powens, the AI, logos), as the admin entered them
//! in Settings → Server → API keys. Stored encrypted in
//! `app_settings.provider_config` (`repo::provider_config`); this is the
//! decrypted copy every reader uses, loaded at startup and replaced on each
//! save, so a change applies without a restart.

use std::collections::BTreeMap;
use std::sync::{Arc, LazyLock, RwLock};

/// One value a provider declares it needs. A secret is never sent back to the
/// browser, only whether it is set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConfigField {
    pub key: &'static str,
    pub secret: bool,
}

/// provider key → field key → value. A missing field is absent, never "".
#[derive(Clone, Default, PartialEq, Eq)]
pub struct ProviderConfig(BTreeMap<String, BTreeMap<String, String>>);

// Never shows a value: only which fields are set.
impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_map()
            .entries(
                self.0
                    .iter()
                    .map(|(p, fields)| (p, fields.keys().collect::<Vec<_>>())),
            )
            .finish()
    }
}

impl ProviderConfig {
    pub fn get(&self, provider: &str, field: &str) -> Option<&str> {
        self.0.get(provider)?.get(field).map(String::as_str)
    }

    pub fn provider(&self, provider: &str) -> Option<&BTreeMap<String, String>> {
        self.0.get(provider)
    }

    /// `None` removes the field; a provider left with no field is dropped.
    pub fn set(&mut self, provider: &str, field: &str, value: Option<String>) {
        match value {
            Some(v) => {
                self.0
                    .entry(provider.to_string())
                    .or_default()
                    .insert(field.to_string(), v);
            }
            None => {
                if let Some(fields) = self.0.get_mut(provider) {
                    fields.remove(field);
                    if fields.is_empty() {
                        self.0.remove(provider);
                    }
                }
            }
        }
    }

    pub(crate) fn insert_provider(&mut self, provider: String, fields: BTreeMap<String, String>) {
        if !fields.is_empty() {
            self.0.insert(provider, fields);
        }
    }
}

static CURRENT: LazyLock<RwLock<Arc<ProviderConfig>>> = LazyLock::new(Default::default);

/// The values in effect. Empty until the server loaded them.
pub fn current() -> Arc<ProviderConfig> {
    CURRENT.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Puts `config` in effect for every later reader.
pub fn replace(config: ProviderConfig) {
    *CURRENT.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(config);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_then_remove_drops_the_empty_provider() {
        let mut c = ProviderConfig::default();
        c.set("jev", "api_key", Some("k".into()));
        assert_eq!(c.get("jev", "api_key"), Some("k"));
        c.set("jev", "api_key", None);
        assert_eq!(c.provider("jev"), None);
    }

    #[test]
    fn debug_never_shows_values() {
        let mut c = ProviderConfig::default();
        c.set("powens", "client_secret", Some("hunter2".into()));
        let s = format!("{c:?}");
        assert!(s.contains("client_secret") && !s.contains("hunter2"), "{s}");
    }
}
