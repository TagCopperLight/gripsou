//! Whole-output regression tests.
//!
//! The 21 tests in `backfill.rs` check specific days and holdings. These check
//! that not a single number moves anywhere in the output — which is the only
//! thing that can catch an optimisation that is 99.99% right.
//!
//! Days are recorded as offsets from today, never as calendar dates, because
//! every computation here anchors on `now()`. Absolute dates would rot
//! overnight.
//!
//! Regenerate deliberately, never reflexively:
//!     UPDATE_GOLDEN=1 cargo test -p gripsou-core --test golden
//! A failing golden file is a conversation about which answer is correct.

mod common;

use chrono::{Duration, NaiveDate, Utc};
use common::{checking_account, seed_user_and_connection};
use gripsou_core::backfill::backfill_connection;
use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::holding::upsert_holding;
use gripsou_core::repo::instrument::resolve_instrument;
use gripsou_core::repo::price::insert_price;
use gripsou_core::repo::snapshot::stamp_snapshot;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

/// Compare `actual` against the committed reference, or rewrite it when
/// UPDATE_GOLDEN=1 is set.
fn assert_golden(name: &str, actual: &str) {
    let path = format!("tests/golden/{name}.txt");
    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::create_dir_all("tests/golden").unwrap();
        std::fs::write(&path, actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("missing {path}; run with UPDATE_GOLDEN=1 to create it"));
    if expected != actual {
        // Show the first differing line rather than dumping thousands.
        let first_diff = expected
            .lines()
            .zip(actual.lines())
            .enumerate()
            .find(|(_, (e, a))| e != a)
            .map(|(i, (e, a))| format!("line {}:\n  expected: {e}\n  actual:   {a}", i + 1))
            .unwrap_or_else(|| {
                format!(
                    "line count differs: expected {} lines, got {}",
                    expected.lines().count(),
                    actual.lines().count()
                )
            });
        panic!("{path} drifted.\n{first_diff}");
    }
}

/// One fixed scenario: two accounts (checking + PEA), a EUR cash line, a USD
/// cash line, two securities, snapshot gaps, a sale, and a stretch that dips
/// below zero. Everything is placed relative to `today`.
async fn seed_scenario(pool: &PgPool) -> (Uuid, Uuid) {
    let today = Utc::now().date_naive();
    let day = |back: i64| today - Duration::days(back);

    let (user_id, connection_id) = seed_user_and_connection(pool).await;
    let mut conn = pool.acquire().await.unwrap();

    let checking = upsert_account(
        &mut conn,
        connection_id,
        &CanonicalAccount {
            name: "Golden Checking".to_string(),
            ..checking_account("g-checking")
        },
    )
    .await
    .unwrap();
    let pea = upsert_account(
        &mut conn,
        connection_id,
        &CanonicalAccount {
            type_key: "pea".to_string(),
            name: "Golden PEA".to_string(),
            ..checking_account("g-pea")
        },
    )
    .await
    .unwrap();

    // EUR cash on the checking account.
    let eur = resolve_instrument(
        &mut conn,
        &InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: "Euro".into(),
            currency: "EUR".into(),
        },
    )
    .await
    .unwrap();
    let eur_holding = upsert_holding(
        &mut conn,
        checking,
        eur,
        &CanonicalHolding {
            account_external_id: "g-checking".into(),
            instrument: InstrumentRef {
                kind: "cash".into(),
                symbol: None,
                isin: None,
                name: "Euro".into(),
                currency: "EUR".into(),
            },
            quantity: dec("1000"),
            cost_basis: dec("1000"),
            valuation: None,
        },
    )
    .await
    .unwrap();

    // USD cash on the PEA: exercises the FX path and the held-flat branch.
    let usd = resolve_instrument(
        &mut conn,
        &InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: "US Dollar".into(),
            currency: "USD".into(),
        },
    )
    .await
    .unwrap();
    let usd_holding = upsert_holding(
        &mut conn,
        pea,
        usd,
        &CanonicalHolding {
            account_external_id: "g-pea".into(),
            instrument: InstrumentRef {
                kind: "cash".into(),
                symbol: None,
                isin: None,
                name: "US Dollar".into(),
                currency: "USD".into(),
            },
            quantity: dec("250"),
            cost_basis: dec("250"),
            valuation: None,
        },
    )
    .await
    .unwrap();
    insert_price(
        &mut conn,
        usd,
        day(120).and_hms_opt(0, 0, 0).unwrap().and_utc(),
        dec("0.92"),
        "EUR",
    )
    .await
    .unwrap();

    // Two securities, one of them sold to zero.
    let mut security_holdings = Vec::new();
    for (n, account_id, ext) in [(0u32, checking, "g-checking"), (1, pea, "g-pea")] {
        let iref = InstrumentRef {
            kind: "equity".into(),
            symbol: Some(format!("GOLD{n}")),
            isin: Some(format!("US{n:010}")),
            name: format!("Golden Equity {n}"),
            currency: "EUR".into(),
        };
        let instrument_id = resolve_instrument(&mut conn, &iref).await.unwrap();
        let holding_id = upsert_holding(
            &mut conn,
            account_id,
            instrument_id,
            &CanonicalHolding {
                account_external_id: ext.into(),
                instrument: iref,
                quantity: dec("40"),
                cost_basis: dec("400"),
                valuation: Some(dec("600")),
            },
        )
        .await
        .unwrap();
        security_holdings.push((holding_id, instrument_id, account_id));

        for back in [120i64, 90, 60, 30, 0] {
            insert_price(
                &mut conn,
                instrument_id,
                day(back).and_hms_opt(0, 0, 0).unwrap().and_utc(),
                dec("10") + Decimal::from(back),
                "EUR",
            )
            .await
            .unwrap();
        }

        sqlx::query(
            "insert into transaction \
             (account_id, instrument_id, ts, booked_on, type, quantity, unit_price, amount, external_id) \
             values ($1, $2, $3, $4, 'buy', $5, $6, $7, $8)",
        )
        .bind(account_id)
        .bind(instrument_id)
        .bind(day(100).and_hms_opt(12, 0, 0).unwrap().and_utc())
        .bind(day(100))
        .bind(dec("40"))
        .bind(dec("10"))
        .bind(dec("-400"))
        .bind(format!("g-buy-{n}"))
        .execute(&mut *conn)
        .await
        .unwrap();
    }

    // Sell the second security to zero, so the nearest-non-zero snapshot search
    // has to reach backwards past the sale.
    let (sold_holding, sold_instrument, sold_account) = security_holdings[1];
    sqlx::query(
        "insert into transaction \
         (account_id, instrument_id, ts, booked_on, type, quantity, unit_price, amount, external_id) \
         values ($1, $2, $3, $4, 'sell', $5, $6, $7, 'g-sell')",
    )
    .bind(sold_account)
    .bind(sold_instrument)
    .bind(day(20).and_hms_opt(12, 0, 0).unwrap().and_utc())
    .bind(day(20))
    .bind(dec("40"))
    .bind(dec("15"))
    .bind(dec("600"))
    .execute(&mut *conn)
    .await
    .unwrap();

    // Cash movements, including one large withdrawal that drives a stretch
    // below zero so the lift branch is exercised.
    for (i, (back, kind, amount)) in [
        (110i64, "deposit", "500"),
        (80, "withdrawal", "-2000"),
        (50, "deposit", "1200"),
        (10, "withdrawal", "-150"),
    ]
    .iter()
    .enumerate()
    {
        sqlx::query(
            "insert into transaction (account_id, ts, booked_on, type, amount, external_id) \
             values ($1, $2, $3, $4, $5, $6)",
        )
        .bind(checking)
        .bind(day(*back).and_hms_opt(12, 0, 0).unwrap().and_utc())
        .bind(day(*back))
        .bind(kind)
        .bind(dec(amount))
        .bind(format!("g-cash-{i}"))
        .execute(&mut *conn)
        .await
        .unwrap();
    }

    // Snapshots with deliberate gaps.
    for holding_id in [
        eur_holding,
        usd_holding,
        security_holdings[0].0,
        sold_holding,
    ] {
        for back in [120i64, 60, 0] {
            let qty = if holding_id == sold_holding && back == 0 {
                dec("0")
            } else {
                dec("40")
            };
            stamp_snapshot(
                &mut conn,
                holding_id,
                day(back),
                qty,
                qty * dec("15"),
                dec("400"),
            )
            .await
            .unwrap();
        }
    }

    (user_id, connection_id)
}

/// Render as `<days-before-today> <holding-index> <quantity> <value> <cost>`.
/// Holdings are numbered by a stable ordering, never by uuid, which changes
/// every run.
async fn backfill_digest(pool: &PgPool) -> String {
    let rows: Vec<(NaiveDate, String, Decimal, Decimal, Decimal)> = sqlx::query_as(
        "select hb.as_of, i.name || '/' || a.external_id, hb.quantity, hb.value, hb.cost_basis \
         from holding_backfill hb \
         join holding h    on h.id = hb.holding_id \
         join account a    on a.id = h.account_id \
         join instrument i on i.id = h.instrument_id \
         order by 2, 1",
    )
    .fetch_all(pool)
    .await
    .unwrap();

    let today = Utc::now().date_naive();
    let mut out = String::new();
    for (as_of, label, qty, value, cost) in rows {
        out.push_str(&format!(
            "{:>5} {label} {qty} {value} {cost}\n",
            (today - as_of).num_days()
        ));
    }
    out
}

#[sqlx::test(migrations = "../migrations")]
async fn backfill_output_is_stable(pool: PgPool) -> anyhow::Result<()> {
    let (_user_id, connection_id) = seed_scenario(&pool).await;
    let mut conn = pool.acquire().await?;
    backfill_connection(&mut conn, connection_id).await?;
    drop(conn);

    assert_golden("backfill", &backfill_digest(&pool).await);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn net_worth_series_output_is_stable(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, connection_id) = seed_scenario(&pool).await;
    let mut conn = pool.acquire().await?;
    backfill_connection(&mut conn, connection_id).await?;
    drop(conn);

    let today = Utc::now().date_naive();
    let rows = gripsou_core::repo::query::net_worth_series(
        &pool,
        user_id,
        today - Duration::days(130),
        today,
    )
    .await?;

    let mut out = String::new();
    for r in rows {
        out.push_str(&format!(
            "{:>5} {} {} {}\n",
            (today - r.as_of).num_days(),
            r.net_worth,
            r.invested,
            r.fx_missing
        ));
    }
    assert_golden("net_worth_series", &out);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn account_series_output_is_stable(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, connection_id) = seed_scenario(&pool).await;
    let mut conn = pool.acquire().await?;
    backfill_connection(&mut conn, connection_id).await?;
    drop(conn);

    let today = Utc::now().date_naive();
    let mut rows = gripsou_core::repo::query::account_series(
        &pool,
        user_id,
        today - Duration::days(130),
        today,
    )
    .await?;

    // account_series orders by account uuid, which is regenerated (and thus
    // reshuffled) every test run. Re-sort here on content instead: (as_of,
    // name) is a total order over these two distinctly-named accounts, with
    // no room for value in the key — if the optimisation under test changes
    // a value, that value must show up as a diff, not silently reorder rows.
    rows.sort_by(|a, b| (a.as_of, &a.name).cmp(&(b.as_of, &b.name)));

    let mut out = String::new();
    for r in rows {
        out.push_str(&format!(
            "{:>5} {} {}\n",
            (today - r.as_of).num_days(),
            r.name,
            r.value
        ));
    }
    assert_golden("account_series", &out);
    Ok(())
}

/// `max` must give the same answer as asking for exactly the range that has
/// data. This is what makes the clamp safe.
///
/// Note what this does and does not prove. Both arms clamp, so it pins that the
/// clamp is deterministic, not that it preserves the pre-clamp answer. The
/// latter is structural rather than testable from here: the `snap` lateral in
/// `net_worth_series` is an INNER `join lateral`, so a day on which no holding
/// has a `holding_point` row drops every (day, holding) pair and produces no
/// group at all. Days before `history_start` were therefore already absent from
/// the response before the clamp existed — the clamp removes days that returned
/// nothing, which is why it cannot move a number.
#[sqlx::test(migrations = "../migrations")]
async fn clamping_does_not_change_the_answer(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, connection_id) = seed_scenario(&pool).await;
    let mut conn = pool.acquire().await?;
    backfill_connection(&mut conn, connection_id).await?;
    drop(conn);

    let today = Utc::now().date_naive();
    let wide = gripsou_core::repo::query::net_worth_series(
        &pool,
        user_id,
        today - Duration::days(4000),
        today,
    )
    .await?;
    let tight = gripsou_core::repo::query::net_worth_series(
        &pool,
        user_id,
        today - Duration::days(121),
        today,
    )
    .await?;

    assert_eq!(wide.len(), tight.len(), "clamping changed the point count");
    for (w, t) in wide.iter().zip(tight.iter()) {
        assert_eq!(w.as_of, t.as_of);
        assert_eq!(w.net_worth, t.net_worth);
        assert_eq!(w.invested, t.invested);
    }
    Ok(())
}

/// Today is always the final point, and its value is exact — the headline
/// net-worth figure reads it.
#[sqlx::test(migrations = "../migrations")]
async fn today_is_the_final_point_and_is_exact(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, connection_id) = seed_scenario(&pool).await;
    let mut conn = pool.acquire().await?;
    backfill_connection(&mut conn, connection_id).await?;
    drop(conn);

    let today = Utc::now().date_naive();
    let sampled = gripsou_core::repo::query::net_worth_series(
        &pool,
        user_id,
        today - Duration::days(4000),
        today,
    )
    .await?;
    let single = gripsou_core::repo::query::net_worth_series(&pool, user_id, today, today).await?;

    assert_eq!(sampled.last().unwrap().as_of, today);
    assert_eq!(sampled.last().unwrap().net_worth, single[0].net_worth);
    Ok(())
}

/// Sampling SELECTS real days; it never averages. Every returned point must
/// equal the value computed for that same single day on its own.
#[sqlx::test(migrations = "../migrations")]
async fn every_sampled_point_is_that_days_real_value(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, connection_id) = seed_scenario(&pool).await;
    let mut conn = pool.acquire().await?;
    backfill_connection(&mut conn, connection_id).await?;
    drop(conn);

    let today = Utc::now().date_naive();
    let sampled = gripsou_core::repo::query::net_worth_series(
        &pool,
        user_id,
        today - Duration::days(4000),
        today,
    )
    .await?;

    for point in sampled.iter().rev().take(5) {
        let single =
            gripsou_core::repo::query::net_worth_series(&pool, user_id, point.as_of, point.as_of)
                .await?;
        assert_eq!(
            point.net_worth, single[0].net_worth,
            "point {} is not that day's real value",
            point.as_of
        );
    }
    Ok(())
}

/// Forces a small sample target (20, against the scenario's 121 days of real
/// history) so the stride is actually > 1 and sampling is exercised for real,
/// unlike the other tests above where every range clamps to the same 121-day
/// scenario and always yields step 1. Proves three things at once: the last
/// point is exactly `today`, every returned point is that day's real value
/// (sampling SELECTS, never averages), and the exact set of returned days
/// matches an independently computed `sample_days` call — pinning the stride
/// itself, not just its endpoints.
#[sqlx::test(migrations = "../migrations")]
async fn sampling_selects_real_days_at_a_forced_stride(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, connection_id) = seed_scenario(&pool).await;
    let mut conn = pool.acquire().await?;
    backfill_connection(&mut conn, connection_id).await?;
    drop(conn);

    let today = Utc::now().date_naive();
    let target = 20;
    let sampled = gripsou_core::repo::query::net_worth_series_with_target(
        &pool,
        user_id,
        today - Duration::days(4000),
        today,
        target,
    )
    .await?;

    // (a) today is exact.
    assert_eq!(sampled.last().unwrap().as_of, today);

    // (b) every returned point is that day's real value on its own — proves
    // sampling selects real days rather than averaging or interpolating.
    for point in &sampled {
        let single =
            gripsou_core::repo::query::net_worth_series(&pool, user_id, point.as_of, point.as_of)
                .await?;
        assert_eq!(
            point.net_worth, single[0].net_worth,
            "point {} is not that day's real value",
            point.as_of
        );
    }

    // (c) the returned as_of sequence is exactly what sample_days computes
    // independently over the same (clamped) history window — pins the stride.
    let history_start = gripsou_core::repo::series::history_start(&pool, user_id)
        .await?
        .expect("scenario has history");
    let expected_days = gripsou_core::repo::series::sample_days(history_start, today, target);
    let actual_days: Vec<_> = sampled.iter().map(|r| r.as_of).collect();
    assert_eq!(actual_days, expected_days);

    Ok(())
}

/// The distribution pie, valued through `valuation_grid` rather than the scalar
/// per-holding functions. Same standard as the series above: every figure must
/// stay identical.
///
/// The digest is ordered by account name, not by the query's own value-descending
/// order, because a uuid and a randomly-assigned colour cannot anchor a stable
/// file. The value ordering is a real part of the contract though — the pie shows
/// the largest slice first — so it is asserted separately below.
#[sqlx::test(migrations = "../migrations")]
async fn distribution_output_is_stable(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, connection_id) = seed_scenario(&pool).await;
    let mut conn = pool.acquire().await?;
    backfill_connection(&mut conn, connection_id).await?;
    drop(conn);

    let rows = gripsou_core::repo::query::distribution(&pool, user_id).await?;

    let values: Vec<Decimal> = rows.iter().map(|r| r.value).collect();
    let mut sorted = values.clone();
    sorted.sort_by(|a, b| b.cmp(a));
    assert_eq!(
        values, sorted,
        "the pie must be ordered largest slice first"
    );

    let mut out: Vec<String> = rows
        .iter()
        .map(|r| format!("{} {} {} {}\n", r.name, r.type_key, r.value, r.fx_missing))
        .collect();
    out.sort();
    assert_golden("distribution", &out.concat());
    Ok(())
}
