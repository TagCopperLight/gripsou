use gripsou_bench::{catalog, config::FixtureConfig, database::ScratchRun, fixture, operations};
#[tokio::test]
async fn committed_trials_start_identically_and_offline_paths_are_verified() -> anyhow::Result<()> {
    assert!(
        catalog::catalog()
            .iter()
            .filter(|c| c.reset == "clone" && c.suite == "backend")
            .count()
            >= 16
    );
    let mut scratch = ScratchRun::new(&std::env::var("DATABASE_URL")?).await?;
    let (template, pool) = scratch.create_db(None).await?;
    let fixture = fixture::seed(&pool, &FixtureConfig::profile("smoke")?).await?;
    pool.close().await;
    for case in catalog::catalog()
        .into_iter()
        .filter(|c| c.reset == "clone" && c.suite == "backend")
    {
        let mut previous = None;
        for _ in 0..2 {
            let (name, pool) = scratch.create_db(Some(&template)).await?;
            let p = operations::prepare(&case, &pool, &fixture).await?;
            let mut e = operations::execute(&p, &pool).await?;
            operations::verify(&p, &pool, &e).await?;
            if let Some(prev) = previous {
                assert_eq!(prev, e.outcome, "{} differs across resets", case.id);
            }
            if case.id == "transactions.apply-description" {
                let original = e.outcome[0].clone();
                e.outcome[0] = serde_json::json!(uuid::Uuid::nil());
                assert!(operations::verify(&p, &pool, &e).await.is_err());
                e.outcome[0] = original.clone();
                sqlx::query("update transaction set budget_category_id=null where id=$1")
                    .bind(serde_json::from_value::<uuid::Uuid>(original)?)
                    .execute(&pool)
                    .await?;
                assert!(operations::verify(&p, &pool, &e).await.is_err());
            }
            previous = Some(e.outcome);
            scratch.remove_db(&name).await?;
        }
    }
    let case = catalog::catalog()
        .into_iter()
        .find(|c| c.id == "portfolio.backfill")
        .unwrap();
    let (name, pool) = scratch.create_db(Some(&template)).await?;
    let prepared = operations::prepare(&case, &pool, &fixture).await?;
    let result = operations::execute(&prepared, &pool).await?;
    sqlx::query("update holding_backfill set quantity=quantity+1,value=value+12 where (holding_id,as_of)=(select holding_id,as_of from holding_backfill order by holding_id,as_of limit 1)").execute(&pool).await?;
    assert!(operations::verify(&prepared, &pool, &result).await.is_err());
    scratch.remove_db(&name).await?;
    scratch.cleanup().await?;
    Ok(())
}
