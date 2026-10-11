use gripsou_bench::{
    compare,
    config::{Command, PROFILES, parse_cli},
    report,
};
async fn dispatch() -> anyhow::Result<i32> {
    match parse_cli(std::env::args().skip(1).collect())? {
        Command::List { json, profiles } => {
            let value = serde_json::json!({"defaults":{"samples":30,"warmups":3,"repeat":1},"profiles":PROFILES.iter().map(|n|gripsou_bench::config::FixtureConfig::profile(n).unwrap()).collect::<Vec<_>>(),"targets":gripsou_bench::catalog::catalog()});
            if json || profiles {
                println!("{}", serde_json::to_string_pretty(&value)?);
            } else {
                for c in gripsou_bench::catalog::catalog() {
                    println!("{}  {}  {}", c.suite, c.id, c.boundary);
                }
            }
            Ok(0)
        }
        Command::Compare(b, c) => {
            let value = compare::compare(&report::read(&b)?, &report::read(&c)?)?;
            println!("{}", serde_json::to_string_pretty(&value)?);
            Ok(if value["compatible"] == true { 0 } else { 1 })
        }
        Command::Run(c) => {
            let set = gripsou_bench::runner::run(&c).await?;
            for r in &set.runs {
                for m in &r.measurements {
                    if m.correct {
                        println!(
                            "{} median {:.3} ms p95 {:.3} ms ({} samples)",
                            m.id,
                            m.metric("median_ms")?,
                            m.metric("p95_ms")?,
                            m.samples_ms.len()
                        );
                    } else {
                        eprintln!("{}: {:?}", m.id, m.errors);
                    }
                }
            }
            if c.save.is_none() {
                println!("{}", serde_json::to_string_pretty(&set)?);
            }
            Ok(
                if set.runs.iter().all(|r| {
                    r.errors.is_empty()
                        && !r.measurements.is_empty()
                        && r.measurements.iter().all(|m| m.correct)
                }) {
                    0
                } else {
                    1
                },
            )
        }
        Command::Cleanup(path) => {
            gripsou_bench::database::ScratchRun::cleanup_manifest(
                &std::env::var("DATABASE_URL")?,
                path,
            )
            .await?;
            Ok(0)
        }
    }
}
#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    match dispatch().await {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("{e:#}");
            std::process::exit(2)
        }
    }
}
