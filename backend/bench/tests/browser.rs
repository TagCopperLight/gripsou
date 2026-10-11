use gripsou_bench::{browser, catalog, report::Measurement};
#[test]
fn child_cannot_claim_success_with_missing_samples_or_wrong_identity() -> anyhow::Result<()> {
    let case = catalog::catalog()
        .into_iter()
        .find(|c| c.id == "browser.dashboard.ready")
        .unwrap();
    let mut m: Measurement = serde_json::from_value(
        serde_json::json!({"id":case.id,"parameters":{},"boundary":case.boundary,"reset":"read","first_ms":1.,"samples_ms":[1.],"batch_size":1,"reset_ms":0.,"rows":1,"outcome":{},"correct":true,"errors":[],"diagnostics":{}}),
    )?;
    browser::validate(&case, &m, 1)?;
    m.samples_ms.clear();
    assert!(browser::validate(&case, &m, 1).is_err());
    m.samples_ms = vec![1.];
    m.id = "unexpected".into();
    assert!(browser::validate(&case, &m, 1).is_err());
    Ok(())
}
