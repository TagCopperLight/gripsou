// The version shown in the UI. Docker has no .git in the build context, so it
// passes GRIPSOU_VERSION in; a local build asks git directly.
fn main() {
    let version = std::env::var("GRIPSOU_VERSION")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(git_describe)
        .unwrap_or_else(|| "dev".into());

    println!("cargo:rustc-env=GRIPSOU_VERSION={version}");
    println!("cargo:rerun-if-env-changed=GRIPSOU_VERSION");
    // Best-effort freshness: the reflog catches new commits, HEAD pointer catches
    // branch switches. A new tag on the current commit will not retrigger, and
    // neither will dirtying or cleaning the working tree without committing
    // (same root cause: no tracked input changed); touch this file after tagging
    // or after such changes if you need the version to reflect them immediately.
    println!("cargo:rerun-if-changed=../../.git/logs/HEAD");
    println!("cargo:rerun-if-changed=../../.git/HEAD");
}

fn git_describe() -> Option<String> {
    let out = std::process::Command::new("git")
        .args(["describe", "--tags", "--always", "--dirty"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}
