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

#[tokio::test]
async fn observed_browser_values_and_filtered_rows_are_checked_against_database()
-> anyhow::Result<()> {
    use gripsou_bench::{
        config::FixtureConfig, database::ScratchRun, fixture, operations, server::ServerHandle,
    };
    let mut scratch = ScratchRun::new(&std::env::var("DATABASE_URL")?).await?;
    let (_, pool) = scratch.create_db(None).await?;
    let f = fixture::seed(&pool, &FixtureConfig::profile("smoke")?).await?;
    let server =
        ServerHandle::start(&pool, f.user_id, std::path::Path::new("/nonexistent")).await?;
    let client = reqwest::Client::new();
    let mut api = serde_json::Map::new();
    for (id, path) in [
        ("http.accounts", "/api/accounts"),
        ("http.budget-summary", "/api/budget/summary"),
        ("http.transactions", "/api/transactions?limit=200"),
    ] {
        let e = operations::http::execute(id, &f, &server, &client).await?;
        api.insert(path.into(), e.outcome["body"].clone());
    }
    let observed = serde_json::json!({"api":api,"action":{}});
    browser::verify_observed(&pool, &f, &observed).await?;
    for (path, field) in [
        ("/api/accounts", "value"),
        ("/api/transactions?limit=200", "amount"),
    ] {
        let mut bad = observed.clone();
        bad["api"][path][0][field] = serde_json::json!("999999");
        assert!(browser::verify_observed(&pool, &f, &bad).await.is_err());
    }
    let mut bad = observed.clone();
    bad["api"]["/api/budget/summary"]["figures"]["income"]["amount"] = serde_json::json!("999999");
    assert!(browser::verify_observed(&pool, &f, &bad).await.is_err());
    let mut ignored_search = observed.clone();
    let unfiltered = ignored_search["api"]
        .as_object_mut()
        .unwrap()
        .remove("/api/transactions?limit=200")
        .unwrap();
    ignored_search["api"]["/api/transactions?limit=200&search=Market"] = unfiltered;
    assert!(
        browser::verify_observed(&pool, &f, &ignored_search)
            .await
            .is_err()
    );
    server.shutdown().await?;
    scratch.cleanup().await?;
    Ok(())
}
