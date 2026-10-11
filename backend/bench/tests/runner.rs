use gripsou_bench::{
    config::{Command, parse_cli},
    runner,
};
#[tokio::test]
async fn first_warmups_samples_and_independent_repeats() -> anyhow::Result<()> {
    let Command::Run(c) = parse_cli(
        [
            "run",
            "--profile",
            "smoke",
            "--only",
            "returns.xirr.valid,transactions.bulk.category",
            "--samples",
            "2",
            "--warmups",
            "1",
            "--repeat",
            "2",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    )?
    else {
        panic!()
    };
    let set = runner::run(&c).await?;
    assert_eq!(set.runs.len(), 2);
    assert_ne!(set.runs[0].id, set.runs[1].id);
    assert_eq!(
        set.runs[0].fixture_fingerprint,
        set.runs[1].fixture_fingerprint
    );
    for r in &set.runs {
        assert!(r.errors.is_empty(), "{:?}", r.errors);
        for m in &r.measurements {
            assert!(m.correct, "{:?}", m.errors);
            assert!(m.first_ms.is_some());
            assert_eq!(m.samples_ms.len(), 2);
            if m.reset == "clone" {
                assert!(m.reset_ms > 0.);
            }
        }
    }
    set.validate()?;
    Ok(())
}

#[tokio::test]
async fn black_box_smoke_has_correct_results() -> anyhow::Result<()> {
    let Command::Run(c) = parse_cli(
        [
            "run",
            "--profile",
            "smoke",
            "--only",
            "portfolio.holdings,transactions.search.rare,transactions.bulk.category",
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
    let report = runner::run(&c).await?;
    assert!(report.runs[0].measurements.iter().all(|m| m.correct));
    report.validate()?;
    assert_eq!(report.runs[0].measurements.len(), 3);
    assert_eq!(
        gripsou_bench::compare::compare(&report, &report)?["compatible"],
        true
    );
    Ok(())
}

#[tokio::test]
async fn typical_budget_and_description_trials_remain_correct() -> anyhow::Result<()> {
    let Command::Run(c) = parse_cli(
        [
            "run",
            "--profile",
            "typical",
            "--only",
            "budget.day-totals,transactions.apply-description",
            "--samples",
            "5",
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
    let set = runner::run(&c).await?;
    for m in &set.runs[0].measurements {
        assert!(m.correct, "{}: {:?}", m.id, m.errors);
        assert_eq!(m.samples_ms.len(), 5);
    }
    Ok(())
}
