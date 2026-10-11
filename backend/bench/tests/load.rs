use gripsou_bench::{
    config::{Command, parse_cli},
    load, runner,
};
#[tokio::test]
async fn queued_latency_failure_and_real_load_accounting() -> anyhow::Result<()> {
    let stats = load::controlled_test(5, 1, Some(2)).await;
    assert_eq!(stats.offered, 5);
    assert_eq!(stats.success + stats.failed, 5);
    assert_eq!(stats.failed, 1);
    assert!(
        stats.latencies.iter().copied().fold(0., f64::max)
            > stats
                .latencies
                .iter()
                .copied()
                .fold(f64::INFINITY, f64::min)
                * 2.
    );
    assert_eq!(stats.peak, 1);
    let Command::Run(c) = parse_cli(
        [
            "run",
            "--suite",
            "load",
            "--profile",
            "smoke",
            "--only",
            "load.pool-saturation",
            "--samples",
            "1",
            "--warmups",
            "0",
            "--concurrency",
            "20",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    )?
    else {
        panic!()
    };
    let set = runner::run(&c).await?;
    assert!(
        set.runs[0].measurements[0].correct,
        "{:?}",
        set.runs[0].measurements[0].errors
    );
    assert_eq!(set.runs[0].measurements[0].samples_ms.len(), 100);
    Ok(())
}

#[test]
fn same_count_symmetric_but_wrong_transfer_edges_are_rejected() -> anyhow::Result<()> {
    use gripsou_bench::{
        catalog,
        config::FixtureConfig,
        fixture::{self, Fixture},
    };
    let config = FixtureConfig::profile("smoke")?;
    let f = Fixture {
        config,
        user_id: fixture::id(1, 0, 0),
        account_id: fixture::id(3, 0, 0),
        holding_id: fixture::id(4, 0, 3),
        category_id: fixture::id(5, 0, 0),
        tag_id: fixture::id(6, 0, 0),
        syncs: vec![],
    };
    let case = catalog::catalog()
        .into_iter()
        .find(|c| c.id == "load.transactions-during-ingest")
        .unwrap();
    let mut edges = vec![];
    for g in 0..f.config.transactions / f.config.transfer_fraction / 3 {
        if g % f.config.ambiguous_every != 0 && g != 1 {
            let a = fixture::id(7, 0, g * 3);
            let b = fixture::id(7, 0, g * 3 + 1);
            edges.extend([(a, b), (b, a)]);
        }
    }
    load::verify_pair_edges(&case, &f, &edges)?;
    let a = edges[0].0;
    let b = edges[0].1;
    let c = edges[2].0;
    let d = edges[2].1;
    edges[..4].copy_from_slice(&[(a, d), (d, a), (c, b), (b, c)]);
    assert!(load::verify_pair_edges(&case, &f, &edges).is_err());
    Ok(())
}
