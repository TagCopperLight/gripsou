use serde_json::{Value, json};
use std::process::Command;

fn invoke(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_gripsou-bench"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn invalid_invocations_fail_before_database_access() {
    for args in [
        vec!["run", "--samples", "0"],
        vec!["run", "--repeat", "0"],
        vec!["run", "--profile", "unknown"],
        vec!["run", "--suite", "unknown"],
        vec!["run", "--only", "unknown"],
        vec!["run", "--only", ""],
        vec!["run", "--samples"],
        vec!["run", "--typo", "1"],
    ] {
        assert_eq!(invoke(&args).status.code(), Some(2), "{args:?}");
    }
    let listing = invoke(&["list", "--json"]);
    assert!(listing.status.success());
    let listing: Value = serde_json::from_slice(&listing.stdout).unwrap();
    assert_eq!(listing["defaults"]["samples"], 30);
    assert_eq!(listing["defaults"]["warmups"], 3);
    assert_eq!(listing["defaults"]["repeat"], 1);
}

fn report(ms: f64) -> Value {
    let measurement = |id: &str| {
        json!({
            "id": id, "parameters": {}, "boundary": "repository call", "reset": "read",
            "first_ms": ms, "samples_ms": vec![ms; 30], "batch_size": 1,
            "reset_ms": 0.0, "rows": 1, "outcome": {"amount":"100"},
            "correct": true, "errors": [], "diagnostics": {}
        })
    };
    json!({"schema_version":1,"runs": (0..3).map(|i| json!({
        "id":format!("run-{i}"),"commit":"old","dirty_fingerprint":"clean", "timestamp":"2026-01-15T00:00:00Z",
        "environment":{"build":"release","cpu":"same"}, "fixture":{}, "fixture_fingerprint":"fixture-1",
        "suite":"backend","warmups":3,
        "measurements":[measurement("primary"),measurement("guard")],"errors":[]
    })).collect::<Vec<_>>()})
}

fn compare(baseline: &Value, candidate: &Value) -> (i32, Value) {
    let dir = std::env::temp_dir().join(format!("bench-cli-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    for (name, value) in [("baseline", baseline), ("candidate", candidate)] {
        std::fs::write(dir.join(name), serde_json::to_vec(value).unwrap()).unwrap();
    }
    let out = invoke(&[
        "compare",
        dir.join("baseline").to_str().unwrap(),
        dir.join("candidate").to_str().unwrap(),
    ]);
    std::fs::remove_dir_all(dir).unwrap();
    let value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| json!({"stderr":String::from_utf8_lossy(&out.stderr)}));
    (out.status.code().unwrap(), value)
}

#[test]
fn comparison_reports_deltas_and_rejects_incompatible_results() {
    let base = report(100.);
    let (code, result) = compare(&base, &report(75.));
    assert_eq!(code, 0);
    assert_eq!(result["compatible"], true);
    assert!(
        result["changes"]
            .as_array()
            .unwrap()
            .iter()
            .all(|change| change["delta_percent"] == -25.)
    );
    // Comparisons describe measurements; they impose no improvement or noise threshold.
    assert_eq!(compare(&base, &report(120.)).0, 0);
    let mut varied = report(75.);
    varied["runs"][2]["measurements"][0]["samples_ms"] = json!(vec![40.; 30]);
    assert_eq!(compare(&base, &varied).0, 0);
    let (_, zero) = compare(&report(0.), &report(75.));
    assert!(
        zero["changes"]
            .as_array()
            .unwrap()
            .iter()
            .all(|change| change["delta_percent"].is_null())
    );
    for fault in [
        "missing",
        "fixture",
        "incorrect",
        "samples",
        "environment",
        "outcome",
        "duplicate-run",
    ] {
        let mut candidate = report(75.);
        match fault {
            "missing" => {
                candidate["runs"][0]["measurements"]
                    .as_array_mut()
                    .unwrap()
                    .pop();
            }
            "fixture" => candidate["runs"][0]["fixture_fingerprint"] = json!("other"),
            "incorrect" => candidate["runs"][0]["measurements"][0]["correct"] = json!(false),
            "samples" => candidate["runs"][0]["measurements"][0]["samples_ms"] = json!([75.]),
            "environment" => candidate["runs"][0]["environment"]["cpu"] = json!("other"),
            "outcome" => candidate["runs"][0]["measurements"][0]["outcome"]["amount"] = json!("99"),
            "duplicate-run" => candidate["runs"][1]["id"] = candidate["runs"][0]["id"].clone(),
            _ => unreachable!(),
        }
        assert_ne!(compare(&base, &candidate).0, 0, "{fault}");
    }
    let mut candidate = report(75.);
    for run in candidate["runs"].as_array_mut().unwrap() {
        run["commit"] = json!("new");
    }
    assert_eq!(compare(&base, &candidate).0, 0);
}
