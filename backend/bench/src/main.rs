use gripsou_bench::{
    compare,
    config::{Command, PROFILES, parse_cli},
    report,
};
fn dispatch() -> anyhow::Result<i32> {
    match parse_cli(std::env::args().skip(1).collect())? {
        Command::List { json, profiles } => {
            let value = serde_json::json!({"defaults":{"samples":30,"warmups":3,"repeat":1},"profiles":PROFILES.iter().map(|n|gripsou_bench::config::FixtureConfig::profile(n).unwrap()).collect::<Vec<_>>(),"targets":[]});
            if json || profiles {
                println!("{}", serde_json::to_string_pretty(&value)?);
            } else {
                println!("Backend benchmark infrastructure; use list --json or --profiles");
            }
            Ok(0)
        }
        Command::Compare(b, c) => {
            let value = compare::compare(&report::read(&b)?, &report::read(&c)?, &[])?;
            println!("{}", serde_json::to_string_pretty(&value)?);
            Ok(if value["compatible"] == true { 0 } else { 1 })
        }
        Command::Check(b, c, g) => {
            let value = compare::check(&report::read(&b)?, &report::read(&c)?, &report::read(&g)?)?;
            println!("{}", serde_json::to_string_pretty(&value)?);
            Ok(if value["passed"] == true { 0 } else { 1 })
        }
        Command::Run(_) => {
            anyhow::bail!("No selected implemented targets; runner is being initialized")
        }
        Command::Cleanup(_) => anyhow::bail!("scratch lifecycle is being initialized"),
    }
}
fn main() {
    match dispatch() {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("{e:#}");
            std::process::exit(2)
        }
    }
}
