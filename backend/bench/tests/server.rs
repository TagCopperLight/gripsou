use gripsou_bench::{config::FixtureConfig, database::ScratchRun, fixture, server::ServerHandle};
#[tokio::test]
async fn actual_router_authentication_and_isolated_ports() -> anyhow::Result<()> {
    let mut s = ScratchRun::new(&std::env::var("DATABASE_URL")?).await?;
    let (_, p) = s.create_db(None).await?;
    let f = fixture::seed(&p, &FixtureConfig::profile("smoke")?).await?;
    let a = ServerHandle::start(&p, f.user_id, std::path::Path::new("../../frontend/dist")).await?;
    let b = ServerHandle::start(&p, f.user_id, std::path::Path::new("../../frontend/dist")).await?;
    assert_ne!(a.url(), b.url());
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .get(format!("{}/api/health", a.url()))
            .send()
            .await?
            .status(),
        200
    );
    assert_eq!(
        client
            .get(format!("{}/api/holdings", a.url()))
            .send()
            .await?
            .status(),
        401
    );
    let rows: serde_json::Value = client
        .get(format!("{}/api/holdings", a.url()))
        .bearer_auth(a.token())
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert!(!rows.as_array().unwrap().is_empty());
    let old = a.url().to_owned();
    a.shutdown().await?;
    b.shutdown().await?;
    assert!(
        client
            .get(format!("{old}/api/health"))
            .send()
            .await
            .is_err()
    );
    s.cleanup().await?;
    Ok(())
}
