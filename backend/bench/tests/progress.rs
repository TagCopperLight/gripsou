use gripsou_bench::progress;
use serde_json::{Value, json};
use std::process::Command;

#[test]
fn trial_numbering_matches_first_warmup_sample_order() {
    assert_eq!(progress::trial(0, 3, 30), ("first", 1, 1));
    assert_eq!(progress::trial(1, 3, 30), ("warmup", 1, 3));
    assert_eq!(progress::trial(3, 3, 30), ("warmup", 3, 3));
    assert_eq!(progress::trial(4, 3, 30), ("sample", 1, 30));
    assert_eq!(progress::trial(33, 3, 30), ("sample", 30, 30));
    assert_eq!(progress::trial(1, 0, 2), ("sample", 1, 2));
}

#[test]
fn lines_are_prefixed_single_line_json() {
    let l = progress::line(&json!({"type":"done","ok":true}));
    assert_eq!(l, r#"@progress {"ok":true,"type":"done"}"#);
}

fn events(stderr: &[u8]) -> Vec<Value> {
    String::from_utf8_lossy(stderr)
        .lines()
        .filter_map(|l| l.strip_prefix(progress::PREFIX))
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

// Needs DATABASE_URL like the runner tests.
#[test]
fn run_reports_progress_only_when_asked() {
    let args = [
        "run",
        "--profile",
        "smoke",
        "--only",
        "returns.xirr.valid",
        "--samples",
        "2",
        "--warmups",
        "1",
    ];
    let plain = Command::new(env!("CARGO_BIN_EXE_gripsou-bench"))
        .args(args)
        .output()
        .unwrap();
    assert!(
        plain.status.success(),
        "{}",
        String::from_utf8_lossy(&plain.stderr)
    );
    assert!(events(&plain.stderr).is_empty());

    let out = Command::new(env!("CARGO_BIN_EXE_gripsou-bench"))
        .args(args)
        .arg("--progress")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let types: Vec<String> = events(&out.stderr)
        .iter()
        .map(|e| match e["type"].as_str().unwrap() {
            "trial" => format!("trial:{}:{}", e["kind"].as_str().unwrap(), e["n"]),
            "phase" => format!("phase:{}", e["name"].as_str().unwrap()),
            t => t.to_string(),
        })
        .collect();
    assert_eq!(
        types,
        [
            "start",
            "repeat",
            "manifest",
            "phase:seeding",
            "case_start",
            "trial:first:1",
            "trial:warmup:1",
            "trial:sample:1",
            "trial:sample:2",
            "case_end",
            "phase:cleanup",
            "done",
        ]
    );
    let all = events(&out.stderr);
    assert_eq!(all[0]["cases"], json!(["returns.xirr.valid"]));
    let end = all.iter().find(|e| e["type"] == "case_end").unwrap();
    assert_eq!(end["correct"], true);
    assert!(end["median_ms"].as_f64().is_some());
    assert_eq!(all.last().unwrap()["ok"], true);
}
