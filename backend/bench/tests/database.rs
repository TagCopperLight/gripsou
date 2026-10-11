use gripsou_bench::{
    config::FixtureConfig,
    database::{ScratchRun, database_url},
    fixture,
};

#[test]
fn scratch_urls_preserve_query_settings() {
    let result = database_url(
        "postgres://user:pass@localhost:5432/a%20b?sslmode=disable",
        "scratch",
    )
    .unwrap();
    let result = url::Url::parse(&result).unwrap();
    assert_eq!(result.path(), "/scratch");
    assert_eq!(result.query(), Some("sslmode=disable"));
    assert_eq!(result.password(), Some("pass"));
}

#[tokio::test]
async fn cleanup_after_a_panicked_operation_and_refuse_unowned_template() -> anyhow::Result<()> {
    let base = std::env::var("DATABASE_URL")?;
    let mut s = ScratchRun::new(&base).await?;
    assert!(s.create_db(Some("bench_not_owned")).await.is_err());
    let (name, pool) = s.create_db(None).await?;
    let task = tokio::spawn(async move {
        sqlx::query("create table panic_sentinel(id int)")
            .execute(&pool)
            .await
            .unwrap();
        panic!("simulated benchmark panic");
    });
    assert!(task.await.unwrap_err().is_panic());
    s.cleanup().await?;
    let admin = sqlx::PgPool::connect(&database_url(&base, "postgres")?).await?;
    let exists: bool =
        sqlx::query_scalar("select exists(select 1 from pg_database where datname=$1)")
            .bind(name)
            .fetch_one(&admin)
            .await?;
    assert!(!exists);
    admin.close().await;
    Ok(())
}

#[tokio::test]
async fn seeded_clones_have_identical_state_and_committed_changes_are_isolated()
-> anyhow::Result<()> {
    let base = std::env::var("DATABASE_URL")?;
    let mut scratch = ScratchRun::new(&base).await?;
    let (template, pool) = scratch.create_db(None).await?;
    let f = FixtureConfig::profile("smoke")?;
    fixture::seed(&pool, &f).await?;
    pool.close().await;
    let (_, a) = scratch.create_db(Some(&template)).await?;
    let (_, b) = scratch.create_db(Some(&template)).await?;
    let count = |p: sqlx::PgPool| async move {
        sqlx::query_scalar::<_, i64>("select count(*) from transaction")
            .fetch_one(&p)
            .await
    };
    assert_eq!(count(a.clone()).await?, 600);
    assert_eq!(count(b.clone()).await?, 600);
    sqlx::query("update transaction set amount=999999")
        .execute(&a)
        .await?;
    let max: rust_decimal::Decimal = sqlx::query_scalar("select max(amount) from transaction")
        .fetch_one(&b)
        .await?;
    assert!(max < rust_decimal::Decimal::from(999999));
    scratch.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn fixture_balances_quantities_and_semantics_are_repeatable() -> anyhow::Result<()> {
    let mut s = ScratchRun::new(&std::env::var("DATABASE_URL")?).await?;
    let (_, a) = s.create_db(None).await?;
    let (_, b) = s.create_db(None).await?;
    let f = FixtureConfig::profile("smoke")?;
    let fa = fixture::seed(&a, &f).await?;
    let fb = fixture::seed(&b, &f).await?;
    assert_eq!(
        gripsou_bench::report::fingerprint(&fa)?,
        gripsou_bench::report::fingerprint(&fb)?
    );
    let bad:i64=sqlx::query_scalar("select count(*) from holding h join instrument i on i.id=h.instrument_id where i.kind<>'cash' and h.quantity <> (select sum(case side when 'buy' then quantity else -quantity end) from lot where holding_id=h.id)").fetch_one(&a).await?;
    assert_eq!(bad, 0);
    let bad:i64=sqlx::query_scalar("select count(*) from holding h join instrument i on i.id=h.instrument_id join holding_snapshot hs on hs.holding_id=h.id where i.kind<>'cash' and hs.quantity <> (select coalesce(sum(case side when 'buy' then quantity else -quantity end),0) from lot where holding_id=h.id and acquired_on<=hs.as_of)").fetch_one(&a).await?;
    assert_eq!(bad, 0);
    let bad:i64=sqlx::query_scalar("select count(*) from holding h join instrument i on i.id=h.instrument_id join holding_snapshot hs on hs.holding_id=h.id where i.kind='cash' and hs.quantity <> 10000 + (select coalesce(sum(amount),0) from transaction where account_id=h.account_id and booked_on<=hs.as_of)").fetch_one(&a).await?;
    assert_eq!(bad, 0);
    s.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn source_database_is_read_only_and_cannot_be_seeded() -> anyhow::Result<()> {
    let base = std::env::var("DATABASE_URL")?;
    let source = sqlx::PgPool::connect(&base).await?;
    let before:Vec<String>=sqlx::query_scalar("select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='user_today' order by p.oid").fetch_all(&source).await?;
    assert!(
        fixture::seed(&source, &FixtureConfig::profile("smoke")?)
            .await
            .is_err()
    );
    let mut s = ScratchRun::new(&base).await?;
    let (_, p) = s.create_db(None).await?;
    fixture::seed(&p, &FixtureConfig::profile("smoke")?).await?;
    s.cleanup().await?;
    let after:Vec<String>=sqlx::query_scalar("select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='user_today' order by p.oid").fetch_all(&source).await?;
    assert_eq!(before, after);
    let helper: bool =
        sqlx::query_scalar("select exists(select 1 from pg_proc where proname='bench_id')")
            .fetch_one(&source)
            .await?;
    assert!(!helper);
    source.close().await;
    Ok(())
}
