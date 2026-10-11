use crate::{
    catalog,
    config::RunConfig,
    database::ScratchRun,
    fixture, metadata, operations,
    report::{self, Measurement, RunReport, RunSet},
};
use futures_util::FutureExt;
use serde_json::json;
use std::{collections::BTreeMap, panic::AssertUnwindSafe, time::Instant};
pub async fn run(config: &RunConfig) -> anyhow::Result<RunSet> {
    let cases = catalog::select(config)?;
    let base = config
        .database_url
        .clone()
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .ok_or_else(|| anyhow::anyhow!("DATABASE_URL required"))?;
    let (commit, dirty) = metadata::identity()?;
    let mut set = RunSet {
        schema_version: 1,
        runs: vec![],
    };
    for _ in 0..config.repeat {
        let mut scratch = ScratchRun::new(&base).await?;
        let mut report = RunReport {
            id: uuid::Uuid::new_v4().to_string(),
            commit: commit.clone(),
            dirty_fingerprint: dirty.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            environment: BTreeMap::new(),
            fixture: serde_json::to_value(&config.fixture)?,
            fixture_fingerprint: report::fingerprint(&config.fixture)?,
            suite: config.suite.clone(),
            warmups: config.warmups,
            measurements: vec![],
            errors: vec![],
        };
        let result = AssertUnwindSafe(run_inner(config, &cases, &mut scratch, &mut report))
            .catch_unwind()
            .await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => report.errors.push(e.to_string()),
            Err(_) => report.errors.push("benchmark panicked".into()),
        }
        if let Err(e) = scratch.cleanup().await {
            report.errors.push(e.to_string());
        }
        set.runs.push(report);
        if let Some(path) = &config.save {
            report::write_atomic(path, &set)?;
        }
    }
    Ok(set)
}
async fn run_inner(
    config: &RunConfig,
    cases: &[catalog::Case],
    scratch: &mut ScratchRun,
    report: &mut RunReport,
) -> anyhow::Result<()> {
    let setup = Instant::now();
    let (template, pool) = scratch.create_db(None).await?;
    report.environment = metadata::environment(&pool).await?;
    let f = fixture::seed(&pool, &config.fixture).await?;
    pool.close().await;
    // Setup cost is recorded outside compatibility metadata and measured intervals.
    let setup_ms = setup.elapsed().as_secs_f64() * 1000.;
    for case in cases {
        let mut m = Measurement {
            id: case.id.clone(),
            parameters: json!({"limit":200,"deep_offset":if case.id.contains("deep"){10000}else{0},"anchor":config.fixture.anchor}),
            boundary: case.boundary.clone(),
            reset: case.reset.clone(),
            first_ms: None,
            samples_ms: vec![],
            batch_size: 1,
            reset_ms: 0.,
            rows: 0,
            outcome: serde_json::Value::Null,
            correct: false,
            errors: vec![],
            diagnostics: BTreeMap::from([
                ("setup_ms".into(), json!(setup_ms)),
                ("sql_count".into(), json!(null)),
                ("rss_bytes".into(), json!(null)),
            ]),
        };
        let result = AssertUnwindSafe(measure(config, case, scratch, &template, &f, &mut m))
            .catch_unwind()
            .await;
        match result {
            Ok(Ok(())) => m.correct = true,
            Ok(Err(e)) => m.errors.push(e.to_string()),
            Err(_) => m.errors.push("operation panicked".into()),
        }
        if !m.correct {
            report.errors.push(format!("{} failed", case.id));
        }
        eprintln!(
            "{}: {} samples {}",
            case.id,
            m.samples_ms.len(),
            if m.correct { "verified" } else { "FAILED" }
        );
        report.measurements.push(m);
    }
    Ok(())
}
async fn measure(
    config: &RunConfig,
    case: &catalog::Case,
    scratch: &mut ScratchRun,
    template: &str,
    f: &fixture::Fixture,
    m: &mut Measurement,
) -> anyhow::Result<()> {
    let mut read_trial = None;
    if case.reset == "read" {
        let t = Instant::now();
        read_trial = Some(scratch.create_db(Some(template)).await?);
        m.reset_ms += t.elapsed().as_secs_f64() * 1000.;
    }
    for trial in 0..1 + config.warmups + config.samples {
        let fresh = if read_trial.is_none() {
            let t = Instant::now();
            let db = scratch.create_db(Some(template)).await?;
            m.reset_ms += t.elapsed().as_secs_f64() * 1000.;
            Some(db)
        } else {
            None
        };
        let (_, pool) = read_trial.as_ref().or(fresh.as_ref()).unwrap();
        let p = operations::prepare(case, pool, f).await?;
        let e = operations::execute(&p, pool).await?;
        operations::verify(&p, pool, &e).await?;
        if trial == 0 {
            m.first_ms = Some(e.elapsed.as_secs_f64() * 1000.);
            m.outcome = e.outcome.clone();
            m.batch_size = e.batch_size;
            m.rows = e.rows;
        } else {
            anyhow::ensure!(
                m.outcome == e.outcome && m.batch_size == e.batch_size,
                "semantic result changed between trials"
            );
            if trial > config.warmups {
                m.samples_ms.push(e.elapsed.as_secs_f64() * 1000.);
            }
        }
        if let Some((name, _)) = fresh {
            scratch.remove_db(&name).await?;
        }
    }
    if let Some((name, _)) = read_trial {
        scratch.remove_db(&name).await?;
    }
    Ok(())
}
