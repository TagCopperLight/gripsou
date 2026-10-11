use gripsou_bench::{
    config::{Command, parse_cli},
    runner,
};
#[tokio::test]
async fn all_authenticated_endpoints_have_verified_full_body_timings() -> anyhow::Result<()> {
    let Command::Run(c) = parse_cli(
        [
            "run",
            "--suite",
            "http",
            "--profile",
            "smoke",
            "--samples",
            "1",
            "--warmups",
            "0",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    )?
    else {
        panic!()
    };
    let r = runner::run(&c).await?;
    assert!(
        r.runs[0].errors.is_empty(),
        "{:?}",
        r.runs[0]
            .measurements
            .iter()
            .filter(|m| !m.correct)
            .map(|m| (&m.id, &m.errors))
            .collect::<Vec<_>>()
    );
    assert_eq!(r.runs[0].measurements.len(), 12);
    assert!(r.runs[0].measurements.iter().all(|m| m.correct));
    Ok(())
}
