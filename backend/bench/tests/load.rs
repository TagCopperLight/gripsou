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
