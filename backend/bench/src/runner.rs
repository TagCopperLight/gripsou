use crate::progress::{emit, emit_trial};
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
    emit(
        config,
        json!({"type":"start","cases":cases.iter().map(|c| &c.id).collect::<Vec<_>>(),"repeat":config.repeat,"warmups":config.warmups,"samples":config.samples}),
    );
    let base = config
        .database_url
        .clone()
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .ok_or_else(|| anyhow::anyhow!("DATABASE_URL required"))?;
    let frontend = if config.suite == "browser" {
        emit(config, json!({"type":"phase","name":"frontend_build"}));
        Some(crate::browser::build().await?)
    } else {
        None
    };
    let (commit, dirty) = metadata::identity()?;
    let mut set = RunSet {
        schema_version: 1,
        runs: vec![],
    };
    for index in 0..config.repeat {
        emit(
            config,
            json!({"type":"repeat","index":index + 1,"of":config.repeat}),
        );
        let mut scratch = ScratchRun::new(&base).await?;
        emit(
            config,
            json!({"type":"manifest","path":scratch.manifest_path}),
        );
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
        emit(config, json!({"type":"phase","name":"cleanup"}));
        if let Err(e) = scratch.cleanup().await {
            report.errors.push(e.to_string());
        }
        if let Some(build) = &frontend {
            report
                .environment
                .insert("frontend_build".into(), json!(build));
        }
        set.runs.push(report);
        if let Some(path) = &config.save {
            report::write_atomic(path, &set)?;
        }
    }
    emit(config, json!({"type":"done","ok":set.succeeded()}));
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
    emit(config, json!({"type":"phase","name":"seeding"}));
    let f = fixture::seed(&pool, &config.fixture).await?;
    pool.close().await;
    // Setup cost is recorded outside compatibility metadata and measured intervals.
    let setup_ms = setup.elapsed().as_secs_f64() * 1000.;
    for (index, case) in cases.iter().enumerate() {
        emit(
            config,
            json!({"type":"case_start","id":case.id,"index":index + 1,"of":cases.len()}),
        );
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
            Ok(Err(e)) => {
                m.correct = false;
                let error = e.to_string();
                if !m.errors.contains(&error) {
                    m.errors.push(error);
                }
            }
            Err(_) => {
                m.correct = false;
                m.errors.push("operation panicked".into());
            }
        }
        if config.diagnostics && m.correct {
            match crate::diagnostics::collect(case, scratch, &template, &f).await {
                Ok(value) => {
                    m.diagnostics.insert("separate_pass".into(), value);
                }
                Err(e) => {
                    m.correct = false;
                    m.errors.push(format!("diagnostics failed: {e}"));
                }
            }
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
        let stats = (!m.samples_ms.is_empty())
            .then(|| report::statistics(&m.samples_ms).ok())
            .flatten();
        emit(
            config,
            json!({"type":"case_end","id":case.id,"correct":m.correct,"median_ms":stats.map(|s| s.1),"p95_ms":stats.map(|s| s.2),"errors":m.errors}),
        );
        if m.id.starts_with("load.")
            && let Some(samples) = m
                .diagnostics
                .get("background_samples_ms")
                .and_then(|v| v.as_array())
            && samples.iter().any(|v| v.as_f64().unwrap_or(0.) > 0.)
        {
            let mut background = m.clone();
            background.id = format!("{}.background", m.id);
            background.boundary =
                "background application call duration including lock waits".into();
            background.samples_ms = samples.iter().filter_map(|v| v.as_f64()).collect();
            background.first_ms = m
                .diagnostics
                .get("background_first_ms")
                .and_then(|v| v.as_f64());
            background.diagnostics = BTreeMap::new();
            report.measurements.push(background);
        }
        if let Some(version) = m.diagnostics.get("browser_version") {
            report
                .environment
                .insert("browser_version".into(), version.clone());
        }
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
    if case.suite == "load" {
        return crate::load::measure(config, case, scratch, template, f, m).await;
    }
    let mut read_trial = None;
    if case.reset == "read" {
        let t = Instant::now();
        read_trial = Some(scratch.create_db(Some(template)).await?);
        m.reset_ms += t.elapsed().as_secs_f64() * 1000.;
    }
    if case.suite == "browser" {
        let (name, pool) = read_trial.take().unwrap();
        let result = crate::browser::measure(config, case, f, &pool, m).await;
        scratch.remove_db(&name).await?;
        return result;
    }
    let server = if case.suite == "http" {
        Some(
            crate::server::ServerHandle::start(
                &read_trial.as_ref().unwrap().1,
                f.user_id,
                std::path::Path::new("frontend/dist"),
            )
            .await?,
        )
    } else {
        None
    };
    let client = reqwest::Client::new();
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
        let e = if let Some(server) = &server {
            let e = operations::http::execute(&case.id, f, server, &client).await?;
            operations::http::verify(&case.id, f, pool, &e).await?;
            e
        } else {
            let p = operations::prepare(case, pool, f).await?;
            let e = operations::execute(&p, pool).await?;
            operations::verify(&p, pool, &e).await?;
            e
        };
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
        emit_trial(config, &case.id, trial);
    }
    if let Some(server) = server {
        server.shutdown().await?;
    }
    if let Some((name, _)) = read_trial {
        scratch.remove_db(&name).await?;
    }
    Ok(())
}
