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

fn check(baseline: &Value, candidate: &Value, goal: &Value) -> (i32, Value) {
    let dir = std::env::temp_dir().join(format!("bench-cli-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    for (name, value) in [
        ("baseline", baseline),
        ("candidate", candidate),
        ("goal", goal),
    ] {
        std::fs::write(dir.join(name), serde_json::to_vec(value).unwrap()).unwrap();
    }
    let out = invoke(&[
        "check",
        dir.join("baseline").to_str().unwrap(),
        dir.join("candidate").to_str().unwrap(),
        "--goal",
        dir.join("goal").to_str().unwrap(),
    ]);
    std::fs::remove_dir_all(dir).unwrap();
    let value = serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| json!({"stderr":String::from_utf8_lossy(&out.stderr)}));
    (out.status.code().unwrap(), value)
}

fn goal() -> Value {
    json!({"schema_version":1,"primary":{"id":"primary","metric":"median_ms","min_improvement_percent":25.0},
    "companions":[{"id":"guard","metric":"median_ms","max_regression_percent":10.0}],
    "minimum_samples":30,"required_runs":3,"max_noise_percent":10.0,"allow_environment_differences":[]})
}

#[test]
fn goal_requires_real_improvement_and_complete_compatible_correct_runs() {
    let base = report(100.);
    assert_eq!(check(&base, &report(75.), &goal()).0, 0);
    assert_eq!(check(&base, &report(76.), &goal()).0, 1);
    for fault in [
        "missing",
        "fixture",
        "incorrect",
        "samples",
        "noise",
        "zero",
        "environment",
        "outcome",
        "duplicate-run",
    ] {
        let mut b = base.clone();
        let mut c = report(75.);
        match fault {
            "missing" => {
                c["runs"][0]["measurements"].as_array_mut().unwrap().pop();
            }
            "fixture" => c["runs"][0]["fixture_fingerprint"] = json!("other"),
            "incorrect" => c["runs"][0]["measurements"][0]["correct"] = json!(false),
            "samples" => c["runs"][0]["measurements"][0]["samples_ms"] = json!([75.]),
            "noise" => c["runs"][2]["measurements"][0]["samples_ms"] = json!(vec![40.; 30]),
            "zero" => b = report(0.),
            "environment" => c["runs"][0]["environment"]["cpu"] = json!("other"),
            "outcome" => c["runs"][0]["measurements"][0]["outcome"]["amount"] = json!("99"),
            "duplicate-run" => c["runs"][1]["id"] = c["runs"][0]["id"].clone(),
            _ => unreachable!(),
        }
        assert_ne!(check(&b, &c, &goal()).0, 0, "{fault}");
    }
    let mut unguarded = goal();
    unguarded["companions"] = json!([]);
    assert_ne!(check(&base, &report(75.), &unguarded).0, 0);
    let mut g = goal();
    g["primary"]["metric"] = json!("p95_ms");
    assert_ne!(check(&base, &report(75.), &g).0, 0);
    let mut c = report(75.);
    for run in c["runs"].as_array_mut().unwrap() {
        run["commit"] = json!("new");
    }
    assert_eq!(check(&base, &c, &goal()).0, 0);
}
