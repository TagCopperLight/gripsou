use gripsou_bench::{
    catalog,
    config::{Command, FixtureConfig, parse_cli},
    database::ScratchRun,
    fixture, operations,
};

#[test]
fn catalog_is_unique_and_incompatible_selections_fail() {
    let cases = catalog::catalog();
    assert!(cases.len() >= 26);
    let ids: std::collections::BTreeSet<_> = cases.iter().map(|c| &c.id).collect();
    assert_eq!(ids.len(), cases.len());
    for args in [
        vec![
            "run",
            "--profile",
            "smoke",
            "--only",
            "transactions.page.deep",
        ],
        vec!["run", "--only", "does-not-exist"],
    ] {
        if let Command::Run(c) = parse_cli(args.into_iter().map(str::to_string).collect()).unwrap()
        {
            assert!(catalog::select(&c).is_err());
        }
    }
}

#[tokio::test]
async fn real_reads_reject_wrong_values_and_identity_even_with_the_same_count() -> anyhow::Result<()>
{
    let mut s = ScratchRun::new(&std::env::var("DATABASE_URL")?).await?;
    let (_, pool) = s.create_db(None).await?;
    let f = fixture::seed(&pool, &FixtureConfig::profile("smoke")?).await?;
    for case in catalog::catalog()
        .into_iter()
        .filter(|c| c.id != "transactions.page.deep" && c.reset == "read" && c.suite == "backend")
    {
        let id = case.id.clone();

        let prepared = operations::prepare(&case, &pool, &f).await?;
        let result = operations::execute(&prepared, &pool).await?;
        operations::verify(&prepared, &pool, &result).await?;
        if id == "portfolio.holdings" {
            let mut bad = operations::execute(&prepared, &pool).await?;
            bad.outcome[0]["value"] = serde_json::json!("999999");
            assert!(operations::verify(&prepared, &pool, &bad).await.is_err());
        }
        if id == "transactions.page.first" {
            let mut bad = operations::execute(&prepared, &pool).await?;
            bad.outcome[0]["id"] = serde_json::json!(uuid::Uuid::nil());
            assert!(operations::verify(&prepared, &pool, &bad).await.is_err());
        }
    }
    s.cleanup().await?;
    Ok(())
}
