use serde_json::{Value, json};
use std::collections::BTreeMap;
fn command(program: &str, args: &[&str]) -> String {
    std::process::Command::new(program)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unavailable".into())
}
pub fn identity() -> anyhow::Result<(String, String)> {
    let commit = command("git", &["rev-parse", "HEAD"]);
    let mut state = command("git", &["diff", "HEAD", "--binary"]).into_bytes();
    let root = command("git", &["rev-parse", "--show-toplevel"]);
    let untracked = command(
        "git",
        &["-C", &root, "ls-files", "--others", "--exclude-standard"],
    );
    if untracked != "unavailable" {
        for path in untracked.lines() {
            state.extend_from_slice(path.as_bytes());
            state.extend(std::fs::read(std::path::Path::new(&root).join(path))?);
        }
    }
    Ok((commit, crate::report::fingerprint(&state)?))
}
pub async fn environment(pool: &sqlx::PgPool) -> anyhow::Result<BTreeMap<String, Value>> {
    let mut e = BTreeMap::new();
    e.insert(
        "build_mode".into(),
        json!(if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }),
    );
    e.insert("rustc".into(), json!(command("rustc", &["--version"])));
    e.insert("os".into(), json!(command("uname", &["-sr"])));
    e.insert("architecture".into(), json!(std::env::consts::ARCH));
    let cpu = std::fs::read_to_string("/proc/cpuinfo").ok().and_then(|s| {
        s.lines()
            .find(|l| l.starts_with("model name"))
            .map(str::to_string)
    });
    e.insert("cpu".into(), json!(cpu));
    e.insert("pool_max_connections".into(), json!(10));
    let rows:Vec<(String,String)>=sqlx::query_as("select name,setting from pg_settings where name in ('server_version','shared_buffers','work_mem','effective_cache_size','max_connections','jit','fsync','synchronous_commit','full_page_writes','random_page_cost') order by name").fetch_all(pool).await?;
    e.insert(
        "postgres".into(),
        json!(rows.into_iter().collect::<BTreeMap<_, _>>()),
    );
    Ok(e)
}
