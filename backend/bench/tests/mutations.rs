use gripsou_bench::{catalog, config::FixtureConfig, database::ScratchRun, fixture, operations};
#[tokio::test]
async fn committed_trials_start_identically_and_offline_paths_are_verified() -> anyhow::Result<()> {
    assert!(
        catalog::catalog()
            .iter()
            .filter(|c| c.reset == "clone")
            .count()
            >= 16
    );
    let mut scratch = ScratchRun::new(&std::env::var("DATABASE_URL")?).await?;
    let (template, pool) = scratch.create_db(None).await?;
    let fixture = fixture::seed(&pool, &FixtureConfig::profile("smoke")?).await?;
    pool.close().await;
    for case in catalog::catalog()
        .into_iter()
        .filter(|c| c.reset == "clone")
    {
        let mut previous = None;
        for _ in 0..2 {
            let (name, pool) = scratch.create_db(Some(&template)).await?;
            let p = operations::prepare(&case, &pool, &fixture).await?;
            let e = operations::execute(&p, &pool).await?;
            operations::verify(&p, &pool, &e).await?;
            if let Some(prev) = previous {
                assert_eq!(prev, e.outcome, "{} differs across resets", case.id);
            }
            previous = Some(e.outcome);
            scratch.remove_db(&name).await?;
        }
    }
    scratch.cleanup().await?;
    Ok(())
}
