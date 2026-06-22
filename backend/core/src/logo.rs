//! Logo URL construction for institutions (banks/brokers), mirroring the
//! Brandfetch parameters used for instrument logos in `repo/instrument.rs`.

// To add a bank, find its connector uuid + name with:
//   select distinct institution_key, institution_name
//     from connection where institution_key is not null;
//
// (Powens connector uuid, brandfetch domain)
const INSTITUTION_DOMAINS: &[(&str, &str)] = &[
    // BoursoBank
    ("07d76adf-ae35-5b38-aca8-67aafba13169", "boursorama.com"),
    // Caisse d'Épargne
    ("13949b61-e3e6-50ed-9d82-451943ec35d0", "caisse-epargne.fr"),
    // Revolut
    ("8f2b0418-c344-574e-8438-fc0878ade068", "revolut.com"),
];

/// Apply the same Brandfetch parameters the instrument logos use:
/// `/fallback/404/theme/light` and `?c={BRANDFETCH_CLIENT_ID}` when set.
pub(crate) fn brandfetch_decorate(base: &str) -> String {
    let mut url = format!("{base}/fallback/404/theme/light");
    if let Ok(c) = std::env::var("BRANDFETCH_CLIENT_ID") {
        url.push_str(&format!("?c={c}"));
    }
    url
}

/// Logo URL for an institution by its connector key, or `None` when the key is
/// absent or unmapped.
pub fn institution_logo_url(institution_key: Option<&str>) -> Option<String> {
    let key = institution_key?;
    let domain = INSTITUTION_DOMAINS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, d)| *d)?;
    Some(brandfetch_decorate(&format!(
        "https://cdn.brandfetch.io/{domain}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decorate_uses_instrument_logo_params() {
        let url = brandfetch_decorate("https://cdn.brandfetch.io/x.fr");
        assert!(
            url.starts_with("https://cdn.brandfetch.io/x.fr/fallback/404/theme/light"),
            "got {url}"
        );
    }

    #[test]
    fn logo_none_when_key_absent() {
        assert_eq!(institution_logo_url(None), None);
    }

    #[test]
    fn logo_none_when_key_unmapped() {
        assert_eq!(institution_logo_url(Some("not-a-real-key")), None);
    }
}
