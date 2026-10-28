//! Saving keys takes effect without a restart. One test: it changes the
//! process-wide config, which other tests in this binary would race with.

use gripsou_core::provider_config::{self, ProviderConfig};
use gripsou_core::testkit;
use gripsou_jobs::Deps;

#[test]
fn saved_keys_apply_without_restart() {
    provider_config::replace(ProviderConfig::default());
    let deps = Deps::build(
        testkit::encryption_key(),
        "EUR".into(),
        "https://g.example".into(),
    );
    assert!(deps.account("powens").is_none());
    assert!(!gripsou_jobs::available_categorizers().contains(&"jev"));

    let mut c = ProviderConfig::default();
    for (f, v) in [
        ("client_id", "id"),
        ("domain", "x.biapi.pro"),
        ("client_secret", "s"),
    ] {
        c.set("powens", f, Some(v.into()));
    }
    c.set("jev", "api_key", Some("k".into()));
    provider_config::replace(c.clone());
    deps.reload_accounts(&c);
    assert!(deps.account("powens").is_some());
    assert!(gripsou_jobs::available_categorizers().contains(&"jev"));

    c.set("powens", "client_secret", None);
    provider_config::replace(c.clone());
    deps.reload_accounts(&c);
    assert!(deps.account("powens").is_none());
    provider_config::replace(ProviderConfig::default());
}
