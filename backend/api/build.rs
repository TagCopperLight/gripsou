// The version shown in the UI. A Docker build has no .git, so the host passes
// GRIPSOU_VERSION in (scripts/build-image.sh); a local build asks git directly.
fn main() {
    let version = std::env::var("GRIPSOU_VERSION")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(git_describe)
        .unwrap_or_else(|| "dev".into());

    println!("cargo:rustc-env=GRIPSOU_VERSION={version}");
    println!("cargo:rerun-if-env-changed=GRIPSOU_VERSION");
    // Best-effort freshness: the reflog catches new commits, HEAD catches
    // branch switches. Asked of git, as a worktree keeps both outside `.git/`.
    // A new tag on the current commit, or dirtying the tree without
    // committing, changes neither: touch this file to refresh the version.
    for path in ["HEAD", "logs/HEAD"] {
        if let Some(file) = git(&["rev-parse", "--path-format=absolute", "--git-path", path]) {
            println!("cargo:rerun-if-changed={file}");
        }
    }
}

fn git_describe() -> Option<String> {
    git(&["describe", "--tags", "--always", "--dirty"])
}

fn git(args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}
