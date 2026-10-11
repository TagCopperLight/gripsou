use crate::report::{Measurement, RunSet};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Primary {
    pub id: String,
    pub metric: String,
    pub min_improvement_percent: f64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Companion {
    pub id: String,
    pub metric: String,
    pub max_regression_percent: f64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Goal {
    pub schema_version: u32,
    pub primary: Primary,
    pub companions: Vec<Companion>,
    pub minimum_samples: usize,
    pub required_runs: usize,
    pub max_noise_percent: f64,
    pub allow_environment_differences: Vec<String>,
}
impl Goal {
    fn validate(&self) -> Result<()> {
        ensure!(
            self.schema_version == 1 && self.required_runs == 3,
            "goal requires schema 1 and three runs"
        );
        ensure!(
            self.max_noise_percent.is_finite()
                && self.max_noise_percent > 0.
                && self.max_noise_percent <= 10.,
            "noise threshold must be in (0,10]"
        );
        ensure!(
            self.primary.min_improvement_percent.is_finite()
                && self.primary.min_improvement_percent > 0.
                && self.primary.min_improvement_percent <= 100.,
            "invalid improvement threshold"
        );
        let mut ids = BTreeSet::new();
        for (id, metric) in std::iter::once((&self.primary.id, &self.primary.metric))
            .chain(self.companions.iter().map(|c| (&c.id, &c.metric)))
        {
            ensure!(
                !id.is_empty() && ids.insert(id),
                "empty/duplicate goal target"
            );
            ensure!(
                matches!(metric.as_str(), "median_ms" | "p95_ms"),
                "invalid metric"
            );
            ensure!(
                self.minimum_samples >= if metric == "p95_ms" { 100 } else { 30 },
                "insufficient minimum samples"
            );
        }
        ensure!(
            self.companions
                .iter()
                .all(|c| c.max_regression_percent.is_finite() && c.max_regression_percent >= 0.),
            "invalid regression threshold"
        );
        Ok(())
    }
}
fn index(run: &crate::report::RunReport) -> BTreeMap<&str, &Measurement> {
    run.measurements
        .iter()
        .map(|m| (m.id.as_str(), m))
        .collect()
}
pub fn compare(b: &RunSet, c: &RunSet, allowed: &[String]) -> Result<Value> {
    b.validate()?;
    c.validate()?;
    ensure!(
        b.runs.len() == c.runs.len(),
        "different number of independent runs"
    );
    let mut reasons = Vec::new();
    let mut changes = Vec::new();
    let mut acknowledged = Vec::new();
    for (i, (br, cr)) in b.runs.iter().zip(&c.runs).enumerate() {
        if br.fixture_fingerprint != cr.fixture_fingerprint
            || br.fixture != cr.fixture
            || br.suite != cr.suite
            || br.warmups != cr.warmups
        {
            reasons.push(format!("run {i}: incompatible fixture/suite/warmups"));
        }
        if !br.errors.is_empty() || !cr.errors.is_empty() {
            reasons.push(format!("run {i}: failed run"));
        }
        let keys: BTreeSet<_> = br.environment.keys().chain(cr.environment.keys()).collect();
        for key in keys {
            if br.environment.get(key) != cr.environment.get(key) {
                let detail = json!({"run":i,"field":key,"baseline":br.environment.get(key),"candidate":cr.environment.get(key)});
                if allowed.contains(key) {
                    acknowledged.push(detail);
                } else {
                    reasons.push(format!("run {i}: different environment {key}"));
                }
            }
        }
        let bi = index(br);
        let ci = index(cr);
        if bi.keys().collect::<Vec<_>>() != ci.keys().collect::<Vec<_>>() {
            reasons.push(format!("run {i}: missing/extra measurement"));
        }
        for (id, bm) in bi {
            if let Some(cm) = ci.get(id) {
                if bm.parameters != cm.parameters
                    || bm.boundary != cm.boundary
                    || bm.reset != cm.reset
                    || bm.batch_size != cm.batch_size
                    || bm.samples_ms.len() != cm.samples_ms.len()
                {
                    reasons.push(format!("{id}: different measurement contract"));
                }
                if !bm.correct || !cm.correct || bm.outcome != cm.outcome {
                    reasons.push(format!("{id}: failed/different semantic outcome"));
                }
                for metric in ["median_ms", "p95_ms"] {
                    if let (Ok(old), Ok(new)) = (bm.metric(metric), cm.metric(metric)) {
                        changes.push(json!({"run":i,"id":id,"metric":metric,"baseline":old,"candidate":new,"delta_ms":new-old,"delta_percent":if old>0. {Some((new-old)/old*100.)}else{None}}));
                    }
                }
            }
        }
    }
    Ok(
        json!({"compatible":reasons.is_empty(),"reasons":reasons,"changes":changes,"acknowledged_environment_differences":acknowledged}),
    )
}
pub fn check(b: &RunSet, c: &RunSet, g: &Goal) -> Result<Value> {
    g.validate()?;
    let comparison = compare(b, c, &g.allow_environment_differences)?;
    let mut reasons = comparison["reasons"].as_array().unwrap().clone();
    if b.runs.len() != g.required_runs || c.runs.len() != g.required_runs {
        reasons.push(json!("three independent runs per revision required"));
    }
    let targets: Vec<_> = std::iter::once((
        &g.primary.id,
        &g.primary.metric,
        -g.primary.min_improvement_percent,
    ))
    .chain(
        g.companions
            .iter()
            .map(|v| (&v.id, &v.metric, v.max_regression_percent)),
    )
    .collect();
    for (id, metric, limit) in targets {
        for data in [b, c] {
            let mut medians = Vec::new();
            for run in &data.runs {
                if let Some(m) = index(run).get(id.as_str()) {
                    if m.samples_ms.len() < g.minimum_samples {
                        reasons.push(json!(format!("{id}: insufficient samples")));
                    }
                    if let Ok(n) = m.metric("median_ms") {
                        medians.push(n);
                    }
                } else {
                    reasons.push(json!(format!("{id}: missing target")));
                }
            }
            if !medians.is_empty() {
                let (min, median, _, max) = crate::report::statistics(&medians)?;
                if median <= 0. || (max - min) / median * 100. > g.max_noise_percent {
                    reasons.push(json!(format!("{id}: zero/noisy independent runs")));
                }
            }
        }
        for (br, cr) in b.runs.iter().zip(&c.runs) {
            if let (Some(bm), Some(cm)) = (index(br).get(id.as_str()), index(cr).get(id.as_str())) {
                let old = bm.metric(metric)?;
                let new = cm.metric(metric)?;
                if old <= 0. || (new - old) / old * 100. > limit + 1e-9 {
                    reasons.push(json!(format!("{id}: {metric} target missed")));
                }
            }
        }
    }
    Ok(json!({"passed":reasons.is_empty(),"reasons":reasons,"goal":g,"comparison":comparison}))
}
