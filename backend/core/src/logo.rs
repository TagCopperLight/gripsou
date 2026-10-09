//! Logo URL construction for institutions (banks/brokers), mirroring the
//! Brandfetch parameters used for instrument logos in `repo/instrument.rs`.

// To add a bank, find its connector uuid + name with:
//   select distinct institution_key, institution_name
//     from connection where institution_key is not null;
//
// (Powens connector uuid, brandfetch domain)
const INSTITUTION_DOMAINS: &[(&str, &str)] = &[
    // Banque Populaire
    ("de508df8-aa37-537e-a05f-1379526dfa84", "banquepopulaire.fr"),
    // BforBank
    ("646e8e7f-0163-5d75-a95a-27438f82c1de", "bforbank.com"),
    // BNP Paribas
    ("f711dd7a-6289-5bda-b3a4-f2febda8c046", "bnpparibas.com"),
    // BoursoBank
    ("07d76adf-ae35-5b38-aca8-67aafba13169", "boursorama.com"),
    // Caisse d'Épargne
    ("13949b61-e3e6-50ed-9d82-451943ec35d0", "caisse-epargne.fr"),
    // CIC
    ("e9606d38-6b0f-5f76-b573-61a4d00a927d", "cic.fr"),
    // Crédit Agricole
    ("d840908d-5157-5819-8296-474fa4534564", "credit-agricole.fr"),
    // Crédit Mutuel
    ("fc6e059f-c3e6-52d7-8139-6e5e0297fe24", "creditmutuel.fr"),
    // Fortuneo
    ("b247dd6e-4ccc-598c-9f12-ea740465e2f0", "fortuneo.fr"),
    // Hello bank!
    ("5b2ebdf0-9ab2-5e0d-a6d4-26c255f9d2d0", "hellobank.fr"),
    // La Banque Postale
    ("33f88657-7ab0-5dbe-b8c3-c98e614afc28", "labanquepostale.fr"),
    // LCL
    ("ad5928c7-89ce-5977-a66d-3360e3aa4029", "lcl.fr"),
    // Monabanq
    ("306b84f8-78ad-5a90-93ed-3e5cdb01344a", "monabanq.com"),
    // N26
    ("1f6220d2-cc45-541e-b4ef-6a3c3dd92421", "n26.com"),
    // Revolut
    ("8f2b0418-c344-574e-8438-fc0878ade068", "revolut.com"),
    // Société Générale
    (
        "f5c29767-1bc8-5337-9e4e-68a0fbd91c9a",
        "societegenerale.com",
    ),
    // Trade Republic
    ("5b6a646f-893d-5235-a57d-4b072860363c", "traderepublic.com"),
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
    let Some(domain) = INSTITUTION_DOMAINS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, d)| *d)
    else {
        // Add the key to INSTITUTION_DOMAINS to give it a logo.
        tracing::debug!(institution_key = key, "no logo domain mapped");
        return None;
    };
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
