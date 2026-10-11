//! Machine-readable progress for `run --progress`: one `@progress <json>`
//! line per step on stderr, read by tools/bench-ui.
use crate::config::RunConfig;
use serde_json::Value;

pub const PREFIX: &str = "@progress ";

pub fn line(event: &Value) -> String {
    format!("{PREFIX}{event}")
}

pub fn emit(config: &RunConfig, event: Value) {
    if config.progress {
        eprintln!("{}", line(&event));
    }
}

/// Maps a 0-based trial counter (first, then warmups, then samples) to
/// its kind and 1-based position within that kind.
pub fn trial(trial: usize, warmups: usize, samples: usize) -> (&'static str, usize, usize) {
    if trial == 0 {
        ("first", 1, 1)
    } else if trial <= warmups {
        ("warmup", trial, warmups)
    } else {
        ("sample", trial - warmups, samples)
    }
}

pub fn emit_trial(config: &RunConfig, id: &str, n: usize) {
    let (kind, n, of) = trial(n, config.warmups, config.samples);
    emit(
        config,
        serde_json::json!({"type":"trial","id":id,"kind":kind,"n":n,"of":of}),
    );
}
