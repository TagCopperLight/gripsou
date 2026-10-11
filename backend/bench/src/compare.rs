use crate::report::{Measurement, RunSet};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

fn index(run: &crate::report::RunReport) -> BTreeMap<&str, &Measurement> {
    run.measurements
        .iter()
        .map(|m| (m.id.as_str(), m))
        .collect()
}
pub fn compare(b: &RunSet, c: &RunSet) -> Result<Value> {
    b.validate()?;
    c.validate()?;
    ensure!(
        b.runs.len() == c.runs.len(),
        "different number of independent runs"
    );
    let mut reasons = Vec::new();
    let mut changes = Vec::new();
    for (revision, set) in [("baseline", b), ("candidate", c)] {
        let first = &set.runs[0];
        let reference = index(first);
        for run in &set.runs[1..] {
            if run.commit != first.commit
                || run.dirty_fingerprint != first.dirty_fingerprint
                || run.environment != first.environment
                || run.fixture != first.fixture
                || run.fixture_fingerprint != first.fixture_fingerprint
                || run.suite != first.suite
                || run.warmups != first.warmups
            {
                reasons.push(format!(
                    "{revision}: independent runs do not share a revision/workload/environment"
                ));
            }
            let current = index(run);
            if reference.keys().collect::<Vec<_>>() != current.keys().collect::<Vec<_>>() {
                reasons.push(format!(
                    "{revision}: independent runs have different targets"
                ));
            }
            for (id, m) in &reference {
                if let Some(n) = current.get(id)
                    && (m.parameters != n.parameters
                        || m.boundary != n.boundary
                        || m.reset != n.reset
                        || m.batch_size != n.batch_size
                        || m.samples_ms.len() != n.samples_ms.len()
                        || m.outcome != n.outcome)
                {
                    reasons.push(format!(
                        "{revision}: {id} contract/outcome differs across runs"
                    ));
                }
            }
        }
    }
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
                reasons.push(format!("run {i}: different environment {key}"));
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
    Ok(json!({"compatible":reasons.is_empty(),"reasons":reasons,"changes":changes}))
}
