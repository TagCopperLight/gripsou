use gripsou_bench::{database::ScratchRun, diagnostics};
#[tokio::test]
async fn real_sql_count_is_scoped_and_memory_names_its_process() -> anyhow::Result<()> {
    let mut s = ScratchRun::new(&std::env::var("DATABASE_URL")?).await?;
    let (_, p) = s.create_db(None).await?;
    let ((), count) = diagnostics::count(async {
        sqlx::query("select 1").execute(&p).await.unwrap();
        sqlx::query("select 2").execute(&p).await.unwrap();
    })
    .await;
    assert_eq!(count, 2);
    let value = diagnostics::memory();
    assert_eq!(
        value["scope"],
        "Rust benchmark/application process only; excludes PostgreSQL and Chromium"
    );
    s.cleanup().await?;
    Ok(())
}
