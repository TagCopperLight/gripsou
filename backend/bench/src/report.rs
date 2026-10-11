use anyhow::{Context, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

pub fn statistics(samples: &[f64]) -> anyhow::Result<(f64, f64, f64, f64)> {
    ensure!(!samples.is_empty(), "no samples");
    ensure!(
        samples.iter().all(|n| n.is_finite() && *n >= 0.),
        "invalid duration"
    );
    let mut sorted = samples.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = |p: f64| sorted[((sorted.len() as f64 * p).ceil() as usize).max(1) - 1];
    Ok((sorted[0], rank(0.5), rank(0.95), sorted[sorted.len() - 1]))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunSet {
    pub schema_version: u32,
    pub runs: Vec<RunReport>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunReport {
    pub id: String,
    pub commit: String,
    pub dirty_fingerprint: String,
    pub timestamp: String,
    pub environment: BTreeMap<String, Value>,
    pub fixture: Value,
    pub fixture_fingerprint: String,
    pub suite: String,
    pub warmups: usize,
    pub measurements: Vec<Measurement>,
    pub errors: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Measurement {
    pub id: String,
    pub parameters: Value,
    pub boundary: String,
    pub reset: String,
    pub first_ms: Option<f64>,
    pub samples_ms: Vec<f64>,
    pub batch_size: usize,
    pub reset_ms: f64,
    pub rows: usize,
    pub outcome: Value,
    pub correct: bool,
    pub errors: Vec<String>,
    pub diagnostics: BTreeMap<String, Value>,
}
impl Measurement {
    pub fn metric(&self, metric: &str) -> anyhow::Result<f64> {
        let (_, median, p95, _) = statistics(&self.samples_ms)?;
        match metric {
            "median_ms" => Ok(median),
            "p95_ms" => Ok(p95),
            _ => anyhow::bail!("unknown metric {metric}"),
        }
    }
}
impl RunSet {
    pub fn validate(&self) -> anyhow::Result<()> {
        ensure!(
            self.schema_version == 1 && !self.runs.is_empty(),
            "unsupported schema or empty run set"
        );
        let mut runs = BTreeSet::new();
        for run in &self.runs {
            ensure!(
                !run.id.is_empty() && runs.insert(&run.id),
                "empty/duplicate run ID"
            );
            ensure!(
                !run.fixture_fingerprint.is_empty(),
                "missing fixture fingerprint"
            );
            ensure!(!run.measurements.is_empty(), "empty measurement set");
            let mut ids = BTreeSet::new();
            for m in &run.measurements {
                ensure!(
                    !m.id.is_empty() && ids.insert(&m.id),
                    "empty/duplicate measurement ID"
                );
                ensure!(
                    m.batch_size > 0 && m.reset_ms.is_finite() && m.reset_ms >= 0.,
                    "invalid batch/reset"
                );
                if let Some(n) = m.first_ms {
                    ensure!(n.is_finite() && n >= 0., "invalid first duration");
                }
                if !m.samples_ms.is_empty() {
                    statistics(&m.samples_ms)?;
                }
                ensure!(
                    !m.correct || (!m.samples_ms.is_empty() && m.errors.is_empty()),
                    "invalid successful measurement"
                );
            }
        }
        Ok(())
    }
}
pub fn fingerprint(value: &impl Serialize) -> anyhow::Result<String> {
    // Value's default map ordering canonicalizes nested JSON object keys too.
    let canonical = serde_json::to_value(value)?;
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&canonical)?)
    ))
}
pub fn read<T: serde::de::DeserializeOwned>(path: &Path) -> anyhow::Result<T> {
    serde_json::from_slice(
        &std::fs::read(path).with_context(|| format!("read {}", path.display()))?,
    )
    .context("invalid JSON artifact")
}
pub fn write_atomic(path: &Path, value: &impl Serialize) -> anyhow::Result<()> {
    use std::io::Write;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let tmp = parent.join(format!(".bench-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(&serde_json::to_vec_pretty(value)?)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)?;
        Ok::<_, anyhow::Error>(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}
