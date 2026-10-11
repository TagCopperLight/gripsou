use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const PROFILES: &[&str] = &[
    "smoke",
    "typical",
    "large-ledger",
    "active-investor",
    "long-history",
    "multi-currency",
    "transfer-heavy",
    "shared-database",
    "large-portfolio",
];
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixtureConfig {
    pub version: u32,
    pub profile: String,
    pub seed: u64,
    pub anchor: String,
    pub accounts: usize,
    pub connections: usize,
    pub holdings: usize,
    pub days: i64,
    pub transactions: usize,
    pub lots_per_security: usize,
    pub users: usize,
    pub snapshot_stride: i64,
    pub price_stride: i64,
    pub categories: usize,
    pub tags: usize,
    pub reporting_currency: String,
    pub currencies: Vec<String>,
    pub missing_price_every: usize,
    pub transfer_fraction: usize,
    pub ambiguous_every: usize,
}
impl FixtureConfig {
    pub fn profile(name: &str) -> Result<Self> {
        ensure!(PROFILES.contains(&name), "unknown profile {name}");
        let (a, c, h, d, t, l) = match name {
            "smoke" => (2, 1, 4, 450, 600, 2),
            "typical" | "shared-database" => (6, 3, 13, 1300, 5000, 4),
            "large-ledger" => (20, 10, 42, 1300, 100000, 4),
            "active-investor" => (6, 3, 106, 1300, 5000, 100),
            "long-history" => (6, 3, 13, 3650, 10000, 4),
            "multi-currency" => (6, 3, 15, 1300, 5000, 4),
            "transfer-heavy" => (20, 10, 40, 1300, 10000, 4),
            "large-portfolio" => (40, 20, 500, 1300, 10000, 4),
            _ => unreachable!(),
        };
        Ok(Self {
            version: 1,
            profile: name.into(),
            seed: 1,
            anchor: "2026-01-15".into(),
            accounts: a,
            connections: c,
            holdings: h,
            days: d,
            transactions: t,
            lots_per_security: l,
            users: if name == "shared-database" { 100 } else { 1 },
            snapshot_stride: if name == "long-history" { 90 } else { 30 },
            price_stride: if name == "long-history" { 14 } else { 7 },
            categories: 12,
            tags: 6,
            reporting_currency: if name == "multi-currency" {
                "USD"
            } else {
                "EUR"
            }
            .into(),
            currencies: if name == "multi-currency" {
                vec!["EUR".into(), "USD".into(), "GBP".into()]
            } else {
                vec!["EUR".into()]
            },
            missing_price_every: if name == "long-history" { 5 } else { 0 },
            transfer_fraction: if name == "transfer-heavy" { 2 } else { 10 },
            ambiguous_every: 5,
        })
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(self.seed == 1, "fixture version 1 supports seed 1 only");
        ensure!(
            self.accounts > self.currencies.len(),
            "accounts must include same-currency transfer counterparts"
        );
        ensure!(
            [
                self.accounts,
                self.connections,
                self.holdings,
                self.transactions,
                self.users,
                self.lots_per_security,
                self.categories,
                self.tags
            ]
            .iter()
            .all(|n| *n < i32::MAX as usize)
                && self.days < 100000,
            "fixture dimensions exceed generator bounds"
        );
        ensure!(
            self.accounts >= 2
                && self.connections > 0
                && self.connections <= self.accounts
                && self.holdings >= self.accounts + 2
                && self.days >= 450
                && self.transactions >= 200
                && self.users > 0
                && self.lots_per_security >= 2
                && self.lots_per_security.is_multiple_of(2),
            "invalid fixture dimensions: accounts>=2, holdings>=accounts+2, days>=450, transactions>=200, even lots>=2 required"
        );
        ensure!(
            self.snapshot_stride > 0
                && self.price_stride > 0
                && self.categories >= 3
                && self.tags >= 1
                && self.transfer_fraction >= 2
                && self.ambiguous_every >= 2,
            "invalid fixture strides/categories/tags/transfers"
        );
        chrono::NaiveDate::parse_from_str(&self.anchor, "%Y-%m-%d")?;
        Ok(())
    }
}
#[derive(Debug, Clone)]
pub struct RunConfig {
    pub fixture: FixtureConfig,
    pub suite: String,
    pub only: Vec<String>,
    pub samples: usize,
    pub warmups: usize,
    pub repeat: usize,
    pub save: Option<PathBuf>,
    pub database_url: Option<String>,
    pub diagnostics: bool,
    pub concurrency: usize,
}
pub enum Command {
    List { json: bool, profiles: bool },
    Run(RunConfig),
    Compare(PathBuf, PathBuf),
    Check(PathBuf, PathBuf, PathBuf),
    Cleanup(PathBuf),
}
pub fn parse_cli(args: Vec<String>) -> Result<Command> {
    let action = args.first().map(String::as_str).unwrap_or("list");
    if action == "list" {
        ensure!(
            args.iter()
                .skip(1)
                .all(|a| a == "--json" || a == "--profiles"),
            "unknown list option"
        );
        return Ok(Command::List {
            json: args.iter().any(|v| v == "--json"),
            profiles: args.iter().any(|v| v == "--profiles"),
        });
    }
    if action == "cleanup" {
        ensure!(args.len() == 2, "cleanup requires an exact manifest path");
        return Ok(Command::Cleanup(args[1].clone().into()));
    }
    if action == "compare" {
        ensure!(args.len() == 3, "compare requires baseline and candidate");
        return Ok(Command::Compare(
            args[1].clone().into(),
            args[2].clone().into(),
        ));
    }
    if action == "check" {
        ensure!(
            args.len() == 5 && args[3] == "--goal",
            "check requires baseline candidate --goal path"
        );
        return Ok(Command::Check(
            args[1].clone().into(),
            args[2].clone().into(),
            args[4].clone().into(),
        ));
    }
    ensure!(action == "run", "unknown command {action}");
    let mut pairs = std::collections::BTreeMap::new();
    let mut diagnostics = false;
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--diagnostics" {
            diagnostics = true;
            i += 1;
            continue;
        }
        ensure!(i + 1 < args.len(), "{} needs a value", args[i]);
        ensure!(
            pairs
                .insert(args[i].as_str(), args[i + 1].as_str())
                .is_none(),
            "duplicate option {}",
            args[i]
        );
        i += 2;
    }
    let known = [
        "--profile",
        "--suite",
        "--only",
        "--samples",
        "--warmups",
        "--repeat",
        "--save",
        "--database-url",
        "--accounts",
        "--connections",
        "--holdings",
        "--days",
        "--transactions",
        "--lots",
        "--users",
        "--seed",
        "--anchor",
        "--snapshot-stride",
        "--price-stride",
        "--categories",
        "--tags",
        "--concurrency",
    ];
    ensure!(
        pairs.keys().all(|k| known.contains(k)),
        "unknown run option"
    );
    let mut f = FixtureConfig::profile(pairs.get("--profile").copied().unwrap_or("typical"))?;
    macro_rules! dimension {
        ($field:ident,$flag:literal) => {
            if let Some(v) = pairs.get($flag) {
                f.$field = v.parse()?;
            }
        };
    }
    dimension!(accounts, "--accounts");
    dimension!(connections, "--connections");
    dimension!(holdings, "--holdings");
    dimension!(days, "--days");
    dimension!(transactions, "--transactions");
    dimension!(lots_per_security, "--lots");
    dimension!(users, "--users");
    dimension!(seed, "--seed");
    dimension!(snapshot_stride, "--snapshot-stride");
    dimension!(price_stride, "--price-stride");
    dimension!(categories, "--categories");
    dimension!(tags, "--tags");
    if let Some(v) = pairs.get("--anchor") {
        f.anchor = (*v).into();
    }
    f.validate()?;
    let count = |key: &str, default: usize| -> Result<usize> {
        Ok(pairs
            .get(key)
            .map(|v| v.parse())
            .transpose()?
            .unwrap_or(default))
    };
    let samples = count("--samples", 30)?;
    let warmups = count("--warmups", 3)?;
    let repeat = count("--repeat", 1)?;
    let concurrency = count("--concurrency", 5)?;
    ensure!(
        samples > 0 && repeat > 0 && concurrency > 0,
        "sample/repeat/concurrency count must be positive"
    );
    let suite = pairs
        .get("--suite")
        .copied()
        .unwrap_or("backend")
        .to_string();
    ensure!(
        ["backend", "http", "browser", "load"].contains(&suite.as_str()),
        "unknown suite"
    );
    let only = pairs
        .get("--only")
        .map(|v| v.split(',').map(str::to_string).collect())
        .unwrap_or_default();
    Ok(Command::Run(RunConfig {
        fixture: f,
        suite,
        only,
        samples,
        warmups,
        repeat,
        save: pairs.get("--save").map(PathBuf::from),
        database_url: pairs.get("--database-url").map(|v| (*v).into()),
        diagnostics,
        concurrency,
    }))
}
