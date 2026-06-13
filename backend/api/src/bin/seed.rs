//! Dev seed: fills the database with a single dev user's fixture data so the
//! dashboard has something real to read. Idempotent — rerun any time.
//!
//! Run with Postgres up and DATABASE_URL set:
//!   cargo run -p gripsou-api --bin seed

use std::env;

use chrono::{Duration, Utc};
use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef};
use gripsou_core::repo::{account, holding, instrument, price, snapshot};
use rust_decimal::Decimal;
use rust_decimal::prelude::FromPrimitive;
use sqlx::PgPool;
use uuid::Uuid;

const DAYS: i64 = 1095; // ~3 years of daily history

/// Deterministic mulberry32 PRNG → f64 in [0, 1).
struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6D2B79F5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
    }
}

fn dec(x: f64) -> Decimal {
    Decimal::from_f64(x).unwrap_or(Decimal::ZERO).round_dp(2)
}

struct Acct {
    ext: &'static str,
    name: &'static str,
    type_key: &'static str,
    color: &'static str,
}
struct Raw {
    ticker: &'static str,
    name: &'static str,
    acct: &'static str,
    kind: &'static str,
    qty: f64,
    price: f64,
    invested: f64,
    logo: &'static str,
}

fn accounts() -> Vec<Acct> {
    vec![
        Acct {
            ext: "checking",
            name: "Compte Courant",
            type_key: "checking",
            color: "#6ea8fe",
        },
        Acct {
            ext: "livret",
            name: "Livret A",
            type_key: "savings",
            color: "#5ed3c4",
        },
        Acct {
            ext: "pea",
            name: "PEA",
            type_key: "pea",
            color: "#c084fc",
        },
        Acct {
            ext: "tr",
            name: "Trade Republic",
            type_key: "brokerage",
            color: "#f0b35b",
        },
        Acct {
            ext: "kraken",
            name: "Crypto",
            type_key: "crypto",
            color: "#f49ac1",
        },
    ]
}

fn raws() -> Vec<Raw> {
    vec![
        Raw {
            ticker: "EUR",
            name: "Euro — espèces",
            acct: "checking",
            kind: "cash",
            qty: 4210.55,
            price: 1.0,
            invested: 4210.55,
            logo: "#6ea8fe",
        },
        Raw {
            ticker: "EUR",
            name: "Livret A",
            acct: "livret",
            kind: "cash",
            qty: 22950.0,
            price: 1.0,
            invested: 22600.0,
            logo: "#5ed3c4",
        },
        Raw {
            ticker: "CW8",
            name: "Amundi MSCI World UCITS",
            acct: "pea",
            kind: "etf",
            qty: 78.0,
            price: 540.2,
            invested: 36000.0,
            logo: "#2e7d6b",
        },
        Raw {
            ticker: "AI",
            name: "Air Liquide",
            acct: "pea",
            kind: "equity",
            qty: 60.0,
            price: 168.4,
            invested: 9300.0,
            logo: "#1d4e89",
        },
        Raw {
            ticker: "MC",
            name: "LVMH",
            acct: "pea",
            kind: "equity",
            qty: 18.0,
            price: 642.0,
            invested: 13200.0,
            logo: "#3a3a3a",
        },
        Raw {
            ticker: "TTE",
            name: "TotalEnergies",
            acct: "pea",
            kind: "equity",
            qty: 80.0,
            price: 57.8,
            invested: 4100.0,
            logo: "#c4452f",
        },
        Raw {
            ticker: "VWCE",
            name: "Vanguard FTSE All-World",
            acct: "tr",
            kind: "etf",
            qty: 180.0,
            price: 132.4,
            invested: 20500.0,
            logo: "#9b1c2c",
        },
        Raw {
            ticker: "AAPL",
            name: "Apple Inc.",
            acct: "tr",
            kind: "equity",
            qty: 60.0,
            price: 214.3,
            invested: 11000.0,
            logo: "#555a5e",
        },
        Raw {
            ticker: "NVDA",
            name: "NVIDIA Corp.",
            acct: "tr",
            kind: "equity",
            qty: 95.0,
            price: 128.5,
            invested: 6800.0,
            logo: "#3f7d28",
        },
        Raw {
            ticker: "ASML",
            name: "ASML Holding",
            acct: "tr",
            kind: "equity",
            qty: 8.0,
            price: 660.0,
            invested: 6100.0,
            logo: "#2a5db0",
        },
        Raw {
            ticker: "BTC",
            name: "Bitcoin",
            acct: "kraken",
            kind: "crypto",
            qty: 0.34,
            price: 92400.0,
            invested: 18500.0,
            logo: "#d98318",
        },
        Raw {
            ticker: "ETH",
            name: "Ethereum",
            acct: "kraken",
            kind: "crypto",
            qty: 1.6,
            price: 3180.0,
            invested: 6400.0,
            logo: "#5b6ad0",
        },
        Raw {
            ticker: "SOL",
            name: "Solana",
            acct: "kraken",
            kind: "crypto",
            qty: 4.0,
            price: 146.5,
            invested: 720.0,
            logo: "#6f4fd0",
        },
    ]
}

/// A daily price walk of `n` points ending at `end`.
fn price_walk(seed: u32, n: usize, end: f64, kind: &str) -> Vec<f64> {
    let vol = match kind {
        "crypto" => 0.03,
        "equity" => 0.018,
        _ => 0.01,
    };
    let mut rng = Rng(seed);
    let mut prices = vec![0.0; n];
    prices[n - 1] = end;
    for i in (0..n - 1).rev() {
        let drift = (rng.next() - 0.48) * vol;
        prices[i] = (prices[i + 1] / (1.0 + drift)).max(0.01);
    }
    prices
}

fn hash(s: &str) -> u32 {
    s.bytes()
        .fold(2166136261u32, |h, b| (h ^ b as u32).wrapping_mul(16777619))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let url = env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL must be set"))?;
    let pool = PgPool::connect(&url).await?;
    sqlx::migrate!("../migrations").run(&pool).await?;

    // Idempotent reset: drop the dev user (cascades to connections/accounts/...).
    sqlx::query("delete from users where email = 'dev@gripsou.local'")
        .execute(&pool)
        .await?;

    let user_id = Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash, role) values ($1,'dev@gripsou.local','Dev','x','user')")
        .bind(user_id).execute(&pool).await?;
    sqlx::query("insert into provider (key, display_name, kind, enabled) values ('seed','Seed','account',true) on conflict (key) do nothing")
        .execute(&pool).await?;
    let conn_id = Uuid::new_v4();
    sqlx::query("insert into connection (id, user_id, provider_key, display_name) values ($1,$2,'seed','Seed data')")
        .bind(conn_id).bind(user_id).execute(&pool).await?;

    let base = Utc::now();

    let mut conn = pool.acquire().await?;
    let mut account_ids = std::collections::HashMap::new();
    for a in accounts() {
        let id = account::upsert_account(
            &mut conn,
            conn_id,
            &CanonicalAccount {
                external_id: a.ext.to_string(),
                name: a.name.to_string(),
                type_key: a.type_key.to_string(),
                currency: "EUR".to_string(),
                meta: serde_json::json!({}),
            },
        )
        .await?;
        sqlx::query("update account set color = $1 where id = $2")
            .bind(a.color)
            .bind(id)
            .execute(&pool)
            .await?;
        account_ids.insert(a.ext, id);
    }

    for r in raws() {
        let account_id = account_ids[r.acct];

        let ins = InstrumentRef {
            kind: r.kind.to_string(),
            symbol: if r.kind == "cash" {
                None
            } else {
                Some(r.ticker.to_string())
            },
            isin: None,
            name: r.name.to_string(),
            currency: "EUR".to_string(),
        };
        let instrument_id = instrument::resolve_instrument(&mut conn, &ins).await?;
        sqlx::query("update instrument set logo_url = $1 where id = $2")
            .bind(r.logo)
            .bind(instrument_id)
            .execute(&pool)
            .await?;
        sqlx::query("delete from price where instrument_id = $1")
            .bind(instrument_id)
            .execute(&pool)
            .await?;

        let holding_id = holding::upsert_holding(
            &mut conn,
            account_id,
            instrument_id,
            &CanonicalHolding {
                account_external_id: r.acct.to_string(),
                instrument: ins.clone(),
                quantity: dec(r.qty),
                cost_basis: dec(r.invested),
                valuation: None,
            },
        )
        .await?;

        let walk = if r.kind == "cash" {
            vec![1.0; DAYS as usize]
        } else {
            price_walk(hash(r.ticker), DAYS as usize, r.price, r.kind)
        };

        for d in 0..DAYS {
            let ts = base - Duration::days(DAYS - 1 - d);
            let p = walk[d as usize];
            price::insert_price(&mut conn, instrument_id, ts, dec(p), "EUR").await?;
            let day = ts.date_naive();
            let value = if r.kind == "cash" {
                dec(r.qty)
            } else {
                dec(r.qty * p)
            };
            snapshot::stamp_snapshot(
                &mut conn,
                holding_id,
                day,
                dec(r.qty),
                value,
                dec(r.invested),
            )
            .await?;
        }

        if r.kind != "cash" {
            let mut rng = Rng(hash(r.ticker).wrapping_add(7));
            let n = 2 + (rng.next() * 3.0) as i64;
            let mut q_left = r.qty;
            let mut inv_left = r.invested;
            for i in 0..n {
                let is_last = i == n - 1;
                let q = if is_last {
                    q_left
                } else {
                    (q_left * (0.25 + rng.next() * 0.4)).max(0.0001)
                };
                let inv = if is_last {
                    inv_left
                } else {
                    inv_left * (q / q_left)
                };
                let days_ago = (DAYS as f64 * (0.9 - 0.8 * (i as f64 / n as f64))) as i64;
                let ts = base - Duration::days(days_ago);
                sqlx::query("insert into transaction (account_id, instrument_id, ts, type, quantity, unit_price, amount) values ($1,$2,$3,'buy',$4,$5,$6)")
                    .bind(account_id).bind(instrument_id).bind(ts)
                    .bind(dec(q)).bind(dec(inv / q)).bind(dec(inv))
                    .execute(&pool).await?;
                q_left -= q;
                inv_left -= inv;
            }
        }
    }

    println!(
        "seeded dev user dev@gripsou.local with {} holdings, {} days of history",
        raws().len(),
        DAYS
    );
    Ok(())
}
