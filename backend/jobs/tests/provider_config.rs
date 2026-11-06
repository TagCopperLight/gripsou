//! Saving keys takes effect without a restart.

use gripsou_core::provider_config::ProviderConfig;

#[test]
fn saved_keys_apply_without_restart() {
    let deps = gripsou_jobs::testing::deps();
    assert!(deps.providers().account("powens").is_none());

    let mut c = ProviderConfig::default();
    for (f, v) in [
        ("client_id", "id"),
        ("domain", "x.biapi.pro"),
        ("client_secret", "s"),
    ] {
        c.set("powens", f, Some(v.into()));
    }
    c.set("jev", "api_key", Some("k".into()));
    deps.apply_config(c.clone());
    assert!(deps.providers().account("powens").is_some());
    assert!(deps.providers().available_categorizers().contains(&"jev"));

    c.set("powens", "client_secret", None);
    deps.apply_config(c);
    assert!(deps.providers().account("powens").is_none());
}
