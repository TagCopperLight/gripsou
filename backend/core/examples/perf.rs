//! Performance harness for the operations optimised on the `performance` branch.
//!
//! Creates a throwaway database, migrates it, seeds a synthetic portfolio at a
//! chosen scale, and times each operation over several runs.
//!
//! A fast dev box hides a slow-box problem, so the knobs exist to be turned up
//! until local timings land in production's range (backfill ~1.7 s). Optimising
//! against that stand-in is faithful: the same change helps more on the smaller
//! box.
//!
//!     cargo run -p gripsou-core --example perf -- --holdings 25 --days 2000 --runs 5
//!     cargo run -p gripsou-core --example perf -- --save baseline.json
//!     cargo run -p gripsou-core --example perf -- --compare baseline.json

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use chrono::{Duration as ChronoDuration, Utc};
use rust_decimal::Decimal;
use sqlx::{AssertSqlSafe, Connection, Executor, PgConnection, PgPool};
use uuid::Uuid;

#[derive(Clone)]
struct Args {
    holdings: usize,
    days: i64,
    runs: usize,
    save: Option<String>,
    compare: Option<String>,
    database_url: Option<String>,
}

fn parse_args() -> Args {
    let mut a = Args {
        holdings: 25,
        days: 2000,
        runs: 5,
        save: None,
        compare: None,
        database_url: None,
    };
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        // Deliberately not a closure: a closure capturing `i` would still hold
        // the borrow when `i += 2` runs at the end of the body.
        let val = argv
            .get(i + 1)
            .unwrap_or_else(|| panic!("{} needs a value", argv[i]))
            .clone();
        match argv[i].as_str() {
            "--holdings" => a.holdings = val.parse().expect("--holdings must be a number"),
            "--days" => a.days = val.parse().expect("--days must be a number"),
            "--runs" => a.runs = val.parse().expect("--runs must be a number"),
            "--save" => a.save = Some(val),
            "--compare" => a.compare = Some(val),
            "--database-url" => a.database_url = Some(val),
            other => panic!("unknown flag {other}"),
        }
        i += 2;
    }
    assert!(
        a.runs >= 1,
        "--runs must be at least 1 (summarise() indexes samples[0])"
    );
    a
}

/// min / median / max over the runs, plus how many rows the operation produced.
struct Timing {
    min: Duration,
    median: Duration,
    max: Duration,
    rows: usize,
}

fn summarise(mut samples: Vec<Duration>, rows: usize) -> Timing {
    samples.sort();
    Timing {
        min: samples[0],
        // Upper-middle element, not an average of the two middle elements for
        // an even count — correct for the recommended odd `--runs 5`, and a
        // deliberate simplification otherwise.
        median: samples[samples.len() / 2],
        max: samples[samples.len() - 1],
        rows,
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = parse_args();
    let base_url = args
        .database_url
        .clone()
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .expect("set DATABASE_URL or pass --database-url");

    // Throwaway database so a run never touches the dev data.
    let db_name = format!("perf_{}", Uuid::new_v4().simple());
    let admin_url = base_url.rsplit_once('/').unwrap().0.to_string();
    let mut admin = PgConnection::connect(&format!("{admin_url}/postgres")).await?;
    let create_sql = format!(r#"create database "{db_name}""#);
    admin.execute(AssertSqlSafe(create_sql)).await?;

    let url = format!("{admin_url}/{db_name}");
    // `run()` can panic partway (e.g. an unwrap on a query result, or a bug in
    // a future task's code under test) and a plain `let result = run(...).await`
    // would let that panic unwind straight out of `main`, skipping the cleanup
    // below entirely — it is sequential code, not a destructor, so it only runs
    // if control reaches it normally. There's no `futures` dependency here for
    // `FutureExt::catch_unwind`, so we get the same effect by running `run()`
    // on a spawned task: a panic there is caught by tokio and reported through
    // `JoinError` instead of unwinding this task, guaranteeing the
    // drop-database step below always runs. We then re-raise so the failure is
    // still visible (non-zero exit, printed panic message) after cleanup.
    let url_owned = url.clone();
    let args_owned = args.clone();
    let join_result = tokio::spawn(async move { run(&url_owned, &args_owned).await }).await;

    // Always drop the scratch database, even if the run failed or panicked.
    drop(admin);
    let mut admin = PgConnection::connect(&format!("{admin_url}/postgres")).await?;
    let drop_sql = format!(r#"drop database if exists "{db_name}" with (force)"#);
    admin.execute(AssertSqlSafe(drop_sql)).await?;

    match join_result {
        Ok(inner) => inner,
        Err(join_err) if join_err.is_panic() => std::panic::resume_unwind(join_err.into_panic()),
        Err(join_err) => Err(join_err.into()),
    }
}

async fn run(url: &str, args: &Args) -> anyhow::Result<()> {
    let pool = PgPool::connect(url).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;

    let (user_id, connection_id) = seed(&pool, args.holdings, args.days).await?;

    // The scratch database is seconds old at this point, so autovacuum has not
    // analysed it yet: the planner would work from default row-count/selectivity
    // estimates instead of the real distribution, and could pick a different
    // plan than production (see backend/core/src/backfill.rs ~120-123, where an
    // inflated estimate was observed triggering JIT compilation worth 2.4s of a
    // 3.1s statement). Analyze explicitly so the timed queries below measure the
    // plan Postgres would actually choose once the data has settled.
    pool.execute(AssertSqlSafe("analyze".to_string())).await?;

    let today = Utc::now().date_naive();
    let from = today - ChronoDuration::days(args.days);

    let mut results: BTreeMap<String, Timing> = BTreeMap::new();

    // backfill_connection
    let mut samples = Vec::new();
    let mut rows = 0usize;
    for _ in 0..args.runs {
        // Timed window starts before `acquire()`, matching the other four
        // operations below (which take `&pool` and acquire internally as part
        // of the timed call) — acquisition latency is included everywhere.
        let t = Instant::now();
        let mut conn = pool.acquire().await?;
        rows =
            gripsou_core::backfill::backfill_connection(&mut conn, connection_id).await? as usize;
        samples.push(t.elapsed());
    }
    results.insert("backfill_connection".into(), summarise(samples, rows));

    // net_worth_series
    let mut samples = Vec::new();
    let mut rows = 0usize;
    for _ in 0..args.runs {
        let t = Instant::now();
        rows = gripsou_core::repo::query::net_worth_series(&pool, user_id, from, today)
            .await?
            .len();
        samples.push(t.elapsed());
    }
    results.insert("net_worth_series".into(), summarise(samples, rows));

    // account_series
    let mut samples = Vec::new();
    let mut rows = 0usize;
    for _ in 0..args.runs {
        let t = Instant::now();
        rows = gripsou_core::repo::query::account_series(&pool, user_id, from, today)
            .await?
            .len();
        samples.push(t.elapsed());
    }
    results.insert("account_series".into(), summarise(samples, rows));

    // distribution
    let mut samples = Vec::new();
    let mut rows = 0usize;
    for _ in 0..args.runs {
        let t = Instant::now();
        rows = gripsou_core::repo::query::distribution(&pool, user_id)
            .await?
            .len();
        samples.push(t.elapsed());
    }
    results.insert("distribution".into(), summarise(samples, rows));

    // holdings
    let mut samples = Vec::new();
    let mut rows = 0usize;
    for _ in 0..args.runs {
        let t = Instant::now();
        rows = gripsou_core::repo::query::holdings(&pool, user_id)
            .await?
            .len();
        samples.push(t.elapsed());
    }
    results.insert("holdings".into(), summarise(samples, rows));

    report(&results, args)?;
    Ok(())
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn report(results: &BTreeMap<String, Timing>, args: &Args) -> anyhow::Result<()> {
    let baseline: Option<serde_json::Value> = match &args.compare {
        Some(path) => Some(serde_json::from_str(&std::fs::read_to_string(path)?)?),
        None => None,
    };

    println!(
        "\nholdings={} days={} runs={}\n",
        args.holdings, args.days, args.runs
    );
    println!(
        "{:<22} {:>9} {:>9} {:>9} {:>8}  vs baseline",
        "operation", "min", "median", "max", "rows"
    );
    for (name, t) in results {
        let delta = baseline
            .as_ref()
            .and_then(|b| b[name]["median_ms"].as_f64())
            .map(|old| {
                let new = ms(t.median);
                format!(
                    "{:+.0}% ({:.0} ms -> {:.0} ms)",
                    (new - old) / old * 100.0,
                    old,
                    new
                )
            })
            .unwrap_or_default();
        println!(
            "{:<22} {:>8.0}ms {:>8.0}ms {:>8.0}ms {:>8}  {}",
            name,
            ms(t.min),
            ms(t.median),
            ms(t.max),
            t.rows,
            delta
        );
    }
    println!();

    if let Some(path) = &args.save {
        let json: serde_json::Value = results
            .iter()
            .map(|(k, t)| {
                (
                    k.clone(),
                    serde_json::json!({ "median_ms": ms(t.median), "rows": t.rows }),
                )
            })
            .collect::<serde_json::Map<_, _>>()
            .into();
        std::fs::write(path, serde_json::to_string_pretty(&json)?)?;
        println!("saved baseline to {path}");
    }
    Ok(())
}

/// A portfolio shaped like a real one: two accounts (a checking account and a
/// PEA), a EUR cash line and a USD cash line, and `holdings - 2` securities
/// spread across the two accounts, each with daily prices, buys and sells, and
/// snapshots every 30 days so the backfill has real gaps to fill.
async fn seed(pool: &PgPool, holdings: usize, days: i64) -> anyhow::Result<(Uuid, Uuid)> {
    use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef};
    use gripsou_core::repo::account::upsert_account;
    use gripsou_core::repo::holding::upsert_holding;
    use gripsou_core::repo::instrument::resolve_instrument;
    use gripsou_core::repo::price::insert_price;
    use gripsou_core::repo::snapshot::stamp_snapshot;

    let today = Utc::now().date_naive();
    let start = today - ChronoDuration::days(days);

    let user_id = Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'Perf', 'x')")
        .bind(user_id)
        .bind(format!("perf-{user_id}@test.local"))
        .execute(pool)
        .await?;

    let connection_id = Uuid::new_v4();
    sqlx::query(
        "insert into connection (id, user_id, provider_key, display_name) \
         values ($1, $2, 'powens', 'Perf connection')",
    )
    .bind(connection_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    let mut conn = pool.acquire().await?;
    let mut account_ids = Vec::new();
    for (ext, type_key, currency) in [
        ("perf-checking", "checking", "EUR"),
        ("perf-pea", "pea", "EUR"),
    ] {
        let acct = CanonicalAccount {
            external_id: ext.to_string(),
            name: ext.to_string(),
            type_key: type_key.to_string(),
            currency: currency.to_string(),
            meta: serde_json::json!({}),
        };
        account_ids.push((
            upsert_account(&mut conn, connection_id, &acct).await?,
            ext.to_string(),
        ));
    }

    let mut holding_ids = Vec::new();

    // Two cash lines: one in the account currency, one foreign (exercises the
    // FX path and the "no movement, held flat" branch).
    for (idx, currency) in ["EUR", "USD"].iter().enumerate() {
        let iref = InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: (*currency).to_string(),
            currency: (*currency).to_string(),
        };
        let instrument_id = resolve_instrument(&mut conn, &iref).await?;
        let (account_id, ext) = &account_ids[idx % account_ids.len()];
        let holding_id = upsert_holding(
            &mut conn,
            *account_id,
            instrument_id,
            &CanonicalHolding {
                account_external_id: ext.clone(),
                instrument: iref,
                quantity: Decimal::from(5000),
                cost_basis: Decimal::from(5000),
                valuation: None,
            },
        )
        .await?;
        holding_ids.push(holding_id);
        // A USD rate so the foreign cash line is valuable.
        if *currency == "USD" {
            insert_price(
                &mut conn,
                instrument_id,
                start.and_hms_opt(0, 0, 0).unwrap().and_utc(),
                Decimal::new(92, 2),
                "EUR",
            )
            .await?;
        }
    }

    // Securities.
    for n in 0..holdings.saturating_sub(2) {
        let iref = InstrumentRef {
            kind: "equity".into(),
            symbol: Some(format!("PERF{n}")),
            isin: Some(format!("US{n:010}")),
            name: format!("Perf Equity {n}"),
            currency: "EUR".into(),
        };
        let instrument_id = resolve_instrument(&mut conn, &iref).await?;
        let (account_id, ext) = &account_ids[n % account_ids.len()];
        let holding_id = upsert_holding(
            &mut conn,
            *account_id,
            instrument_id,
            &CanonicalHolding {
                account_external_id: ext.clone(),
                instrument: iref,
                quantity: Decimal::from(100),
                cost_basis: Decimal::from(1000),
                valuation: Some(Decimal::from(1500)),
            },
        )
        .await?;
        holding_ids.push(holding_id);

        // Weekly prices, so the price lookup has something to seek through.
        let mut d = start;
        let mut px = Decimal::from(10);
        while d <= today {
            insert_price(
                &mut conn,
                instrument_id,
                d.and_hms_opt(0, 0, 0).unwrap().and_utc(),
                px,
                "EUR",
            )
            .await?;
            px += Decimal::new(1, 2);
            d += ChronoDuration::days(7);
        }

        // A buy and a sell, so the lot walk and the mean-buy price are
        // exercised. Security 0 is sold in full (-100, matching the buy) so it
        // becomes a zero-quantity position — see the snapshot loop below,
        // which stamps its later snapshots at quantity 0. That exercises the
        // `uv` lateral in backfill.rs (~209-215), which filters
        // `hs.quantity <> 0` to value a fully-sold position by searching
        // backwards past its zero snapshots; the other securities keep a
        // partial sell so the ordinary lot walk is exercised too.
        let sell_qty = if n == 0 {
            Decimal::from(-100)
        } else {
            Decimal::from(-10)
        };
        for (kind, day, qty) in [
            ("buy", start + ChronoDuration::days(10), Decimal::from(60)),
            ("sell", start + ChronoDuration::days(400), sell_qty),
        ] {
            sqlx::query(
                "insert into transaction \
                 (account_id, instrument_id, ts, type, quantity, unit_price, amount, external_id) \
                 values ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(account_id)
            .bind(instrument_id)
            .bind(day.and_hms_opt(12, 0, 0).unwrap().and_utc())
            .bind(kind)
            .bind(qty.abs())
            .bind(Decimal::from(12))
            .bind(qty * Decimal::from(12))
            .bind(format!("perf-{n}-{kind}"))
            .execute(&mut *conn)
            .await?;
        }
    }

    // Cash movements: one every three days on the checking account, which is
    // what makes the movements-after sum expensive.
    let (checking_id, _) = &account_ids[0];
    let mut d = start;
    let mut i = 0;
    while d <= today {
        sqlx::query(
            "insert into transaction (account_id, ts, booked_on, type, amount, external_id) \
             values ($1, $2, $3, $4, $5, $6)",
        )
        .bind(checking_id)
        .bind(d.and_hms_opt(12, 0, 0).unwrap().and_utc())
        .bind(d)
        .bind(if i % 5 == 0 { "deposit" } else { "withdrawal" })
        .bind(if i % 5 == 0 {
            Decimal::from(300)
        } else {
            Decimal::from(-40)
        })
        .bind(format!("perf-cash-{i}"))
        .execute(&mut *conn)
        .await?;
        d += ChronoDuration::days(3);
        i += 1;
    }

    // The fully-sold security (see above): its sell lands at start+400 days,
    // so snapshots from that point on are stamped at quantity 0.
    let sold_holding_id = if holdings.saturating_sub(2) > 0 {
        Some(holding_ids[2])
    } else {
        None
    };
    let sold_day = start + ChronoDuration::days(400);

    // Snapshots every 30 days, plus today, so the backfill has gaps to fill.
    for holding_id in &holding_ids {
        let is_sold = Some(*holding_id) == sold_holding_id;
        let mut d = start;
        while d <= today {
            let qty = if is_sold && d >= sold_day {
                Decimal::ZERO
            } else {
                Decimal::from(100)
            };
            stamp_snapshot(
                &mut conn,
                *holding_id,
                d,
                qty,
                Decimal::from(1500),
                Decimal::from(1000),
            )
            .await?;
            d += ChronoDuration::days(30);
        }
        let final_qty = if is_sold {
            Decimal::ZERO
        } else {
            Decimal::from(100)
        };
        stamp_snapshot(
            &mut conn,
            *holding_id,
            today,
            final_qty,
            Decimal::from(1500),
            Decimal::from(1000),
        )
        .await?;
    }

    Ok((user_id, connection_id))
}
