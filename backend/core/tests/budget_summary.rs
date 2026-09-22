mod common;

use chrono::NaiveDate;
use common::{checking_account, checking_account_in, seed_user_and_connection, txn_on_day};
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::budget::assign::set_category;
use gripsou_core::repo::budget::category::list_categories;
use gripsou_core::repo::budget::summary::day_category_totals;
use gripsou_core::repo::transaction::upsert_transaction;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

fn day(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn eur(units: i64) -> Decimal {
    Decimal::new(units * 100, 2)
}

/// The id of a seeded category by its `default_key`.
async fn cat(pool: &PgPool, user_id: Uuid, key: &str) -> Uuid {
    list_categories(pool, user_id)
        .await
        .unwrap()
        .into_iter()
        .find(|c| c.default_key.as_deref() == Some(key))
        .unwrap_or_else(|| panic!("no seeded category {key}"))
        .id
}

/// Insert a cash instrument for a currency and return its id.
async fn cash_instrument(pool: &PgPool, currency: &str) -> Uuid {
    sqlx::query_scalar(
        "insert into instrument (kind, name, currency) values ('cash', $1, $1) returning id",
    )
    .bind(currency)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// One rate for one currency on one day.
async fn rate_on(pool: &PgPool, instrument_id: Uuid, d: NaiveDate, rate: Decimal) {
    let mut conn = pool.acquire().await.unwrap();
    gripsou_core::repo::price::insert_price(
        &mut conn,
        instrument_id,
        d.and_hms_opt(0, 0, 0).unwrap().and_utc(),
        rate,
        "EUR",
    )
    .await
    .unwrap();
}

/// Set the user's reporting currency, the same `prefs->>'currency'` the query
/// reads.
async fn set_reporting_currency(pool: &PgPool, user_id: Uuid, currency: &str) {
    sqlx::query(
        "update users set prefs = jsonb_set(coalesce(prefs, '{}'::jsonb), '{currency}', to_jsonb($2::text)) where id = $1",
    )
    .bind(user_id)
    .bind(currency)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = "../migrations")]
async fn sums_one_category_over_a_period(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    for (ext, d) in [("t1", day(2026, 3, 4)), ("t2", day(2026, 3, 9))] {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn_on_day("acct-1", ext, "withdrawal", eur(-20), d, "LECLERC"),
        )
        .await?;
    }
    drop(conn);
    let groceries = cat(&pool, user_id, "groceries").await;
    let ids: Vec<Uuid> = sqlx::query_scalar("select id from transaction order by external_id")
        .fetch_all(&pool)
        .await?;
    for id in &ids {
        set_category(&pool, user_id, *id, Some(groceries)).await?;
    }

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(rows.len(), 2, "one row per (day, category)");
    let total: Decimal = rows.iter().map(|r| r.amount).sum();
    assert_eq!(total, eur(-40));
    assert!(rows.iter().all(|r| r.category_id == Some(groceries)));
    assert!(
        rows.iter()
            .all(|r| r.category_kind.as_deref() == Some("expense"))
    );
    assert_eq!(rows.iter().map(|r| r.txn_count).sum::<i64>(), 2);
    assert!(rows.iter().all(|r| !r.fx_missing));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn uncategorised_rows_come_back_with_a_null_category(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-1",
            "t1",
            "withdrawal",
            eur(-15),
            day(2026, 3, 4),
            "UNKNOWN",
        ),
    )
    .await?;
    drop(conn);

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].category_id, None);
    assert_eq!(rows[0].category_kind, None);
    assert_eq!(rows[0].amount, eur(-15));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn converts_at_the_transactions_own_date_not_todays(pool: PgPool) -> anyhow::Result<()> {
    // USD was worth 0.50 EUR in March and 0.90 EUR in September. A $100 spend
    // in March is 50 EUR, and must stay 50 EUR when read in September.
    let usd = cash_instrument(&pool, "USD").await;
    rate_on(&pool, usd, day(2026, 3, 1), Decimal::new(50, 2)).await;
    rate_on(&pool, usd, day(2026, 9, 1), Decimal::new(90, 2)).await;

    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id =
        upsert_account(&mut conn, conn_id, &checking_account_in("acct-usd", "USD")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-usd",
            "t1",
            "withdrawal",
            eur(-100),
            day(2026, 3, 4),
            "US SPEND",
        ),
    )
    .await?;
    drop(conn);

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].amount,
        eur(-50),
        "converted at March's rate, not at the latest one"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_missing_rate_is_zero_and_flagged(pool: PgPool) -> anyhow::Result<()> {
    // A cash instrument with no price at all: the rate is unknown, never 1.
    cash_instrument(&pool, "CNY").await;
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id =
        upsert_account(&mut conn, conn_id, &checking_account_in("acct-cny", "CNY")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-cny",
            "t1",
            "withdrawal",
            eur(-100),
            day(2026, 3, 4),
            "CN SPEND",
        ),
    )
    .await?;
    drop(conn);

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].amount, Decimal::ZERO);
    assert!(rows[0].fx_missing, "an unvalued row must say so");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn excluded_categories_count_nowhere(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-1",
            "t1",
            "withdrawal",
            eur(-30),
            day(2026, 3, 4),
            "DUPLICATE",
        ),
    )
    .await?;
    drop(conn);
    let ignore = cat(&pool, user_id, "ignore").await;
    let id: Uuid = sqlx::query_scalar("select id from transaction")
        .fetch_one(&pool)
        .await?;
    set_category(&pool, user_id, id, Some(ignore)).await?;

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert!(rows.is_empty(), "an `excluded` category appears nowhere");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn internal_categories_are_kept(pool: PgPool) -> anyhow::Result<()> {
    // The list hides these behind a toggle; the Sankey needs them, because
    // netting them is how a paired transfer disappears on its own.
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-1",
            "t1",
            "transfer",
            eur(-500),
            day(2026, 3, 4),
            "VIR PEA",
        ),
    )
    .await?;
    drop(conn);
    let investments = cat(&pool, user_id, "investments").await;
    let id: Uuid = sqlx::query_scalar("select id from transaction")
        .fetch_one(&pool)
        .await?;
    set_category(&pool, user_id, id, Some(investments)).await?;

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].category_kind.as_deref(), Some("internal"));
    assert_eq!(rows[0].amount, eur(-500));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn pea_provider_rows_are_excluded(pool: PgPool) -> anyhow::Result<()> {
    // Mirrors query.rs:989 — these are second halves of movements counted
    // elsewhere, and an aggregate that kept them would double-count.
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let pea = gripsou_core::dto::CanonicalAccount {
        type_key: "pea".to_string(),
        ..checking_account("acct-pea")
    };
    let account_id = upsert_account(&mut conn, conn_id, &pea).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-pea",
            "t1",
            "transfer",
            eur(-500),
            day(2026, 3, 4),
            "VIR",
        ),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-pea",
            "t2",
            "deposit",
            eur(40),
            day(2026, 3, 5),
            "DIVIDENDE",
        ),
    )
    .await?;
    drop(conn);

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(
        rows.len(),
        1,
        "the transfer is dropped, the dividend is not"
    );
    assert_eq!(rows[0].amount, eur(40));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn the_window_bounds_are_inclusive(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    for (ext, d) in [
        ("t0", day(2026, 2, 28)),
        ("t1", day(2026, 3, 1)),
        ("t2", day(2026, 3, 31)),
        ("t3", day(2026, 4, 1)),
    ] {
        upsert_transaction(
            &mut conn,
            account_id,
            &txn_on_day("acct-1", ext, "withdrawal", eur(-10), d, "X"),
        )
        .await?;
    }
    drop(conn);

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(rows.len(), 2, "both edges are in, neither neighbour is");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn another_users_rows_are_invisible(pool: PgPool) -> anyhow::Result<()> {
    let (mine, my_conn) = seed_user_and_connection(&pool).await;
    let (_theirs, their_conn) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    for (c, ext) in [(my_conn, "mine"), (their_conn, "theirs")] {
        let account_id = upsert_account(&mut conn, c, &checking_account(ext)).await?;
        upsert_transaction(
            &mut conn,
            account_id,
            &txn_on_day(ext, ext, "withdrawal", eur(-10), day(2026, 3, 4), "X"),
        )
        .await?;
    }
    drop(conn);

    let rows = day_category_totals(&pool, mine, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].amount, eur(-10));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn reporting_currency_converts_at_its_own_days_rate(pool: PgPool) -> anyhow::Result<()> {
    // Reporting in GBP: 1 GBP = 1.25 EUR in March, 1.00 EUR in April. A 100 EUR
    // spend must become a different GBP figure depending on which day it fell
    // on, not the latest rate — the same own-date rule as the account leg.
    let gbp = cash_instrument(&pool, "GBP").await;
    rate_on(&pool, gbp, day(2026, 3, 1), Decimal::new(125, 2)).await;
    rate_on(&pool, gbp, day(2026, 4, 1), Decimal::new(100, 2)).await;

    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    set_reporting_currency(&pool, user_id, "GBP").await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-1",
            "t1",
            "withdrawal",
            eur(-100),
            day(2026, 3, 4),
            "MARCH",
        ),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-1",
            "t2",
            "withdrawal",
            eur(-100),
            day(2026, 4, 4),
            "APRIL",
        ),
    )
    .await?;
    drop(conn);

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 4, 30)).await?;
    assert_eq!(rows.len(), 2);
    let march = rows.iter().find(|r| r.day == day(2026, 3, 4)).unwrap();
    let april = rows.iter().find(|r| r.day == day(2026, 4, 4)).unwrap();
    assert_eq!(march.amount, eur(-80), "100 EUR / 1.25 GBP-rate = 80 GBP");
    assert_eq!(april.amount, eur(-100), "100 EUR / 1.00 GBP-rate = 100 GBP");
    assert!(!march.fx_missing && !april.fx_missing);
    assert!(!march.reporting_fx_missing && !april.reporting_fx_missing);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_missing_reporting_rate_falls_back_to_the_pivot_not_zero(
    pool: PgPool,
) -> anyhow::Result<()> {
    // No rate at all for CHF: the fallback is "report in the pivot", not zero
    // — a user whose reporting currency has no stored rate must still see
    // their net worth's figures, just unconverted, with a flag saying why.
    cash_instrument(&pool, "CHF").await;
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    set_reporting_currency(&pool, user_id, "CHF").await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day("acct-1", "t1", "withdrawal", eur(-30), day(2026, 3, 4), "X"),
    )
    .await?;
    drop(conn);

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].amount,
        eur(-30),
        "falls back to the pivot figure, not zero"
    );
    assert!(
        !rows[0].fx_missing,
        "the account leg (EUR, the pivot) was fine"
    );
    assert!(
        rows[0].reporting_fx_missing,
        "the reporting leg had no rate"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_partly_valued_bucket_keeps_the_valued_leg_and_flags_the_gap(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Two uncategorised transactions on the same day, one an inflow (valued
    // EUR) and one an outflow (unvalued JPY). Uncategorised rows must split
    // by sign (Finding 1): a mixed-sign uncategorised day is two buckets, not
    // one netted one, because `figures()` reads an uncategorised row's own
    // sign to decide income vs expense (spec 2.2) and a pre-netted row has
    // already lost that distinction. This also pins the older "bucket is
    // understated" contract for a partly-unvalued bucket: the unvalued leg's
    // own bucket sums to zero and flags `fx_missing`, rather than dropping
    // out of some other bucket's sum silently.
    cash_instrument(&pool, "JPY").await; // no rate at all
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let eur_account = upsert_account(&mut conn, conn_id, &checking_account("acct-eur")).await?;
    let jpy_account =
        upsert_account(&mut conn, conn_id, &checking_account_in("acct-jpy", "JPY")).await?;
    upsert_transaction(
        &mut conn,
        eur_account,
        &txn_on_day(
            "acct-eur",
            "t1",
            "deposit",
            eur(20),
            day(2026, 3, 4),
            "VALUED",
        ),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        jpy_account,
        &txn_on_day(
            "acct-jpy",
            "t2",
            "withdrawal",
            eur(-100),
            day(2026, 3, 4),
            "UNVALUED",
        ),
    )
    .await?;
    drop(conn);

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(
        rows.len(),
        2,
        "a mixed-sign uncategorised day is two buckets, one per sign"
    );

    let inflow = rows
        .iter()
        .find(|r| r.amount > Decimal::ZERO)
        .expect("the valued inflow's own bucket");
    assert_eq!(inflow.txn_count, 1);
    assert_eq!(inflow.amount, eur(20));
    assert!(!inflow.fx_missing, "this bucket has nothing unvalued in it");

    let outflow = rows
        .iter()
        .find(|r| r.amount <= Decimal::ZERO)
        .expect("the unvalued outflow's own bucket");
    assert_eq!(outflow.txn_count, 1);
    assert_eq!(
        outflow.amount,
        Decimal::ZERO,
        "the unvalued leg drops out of the sum instead of zeroing it into the inflow's bucket"
    );
    assert!(outflow.fx_missing, "this bucket is understated");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn a_payday_shape_keeps_income_and_expense_apart(pool: PgPool) -> anyhow::Result<()> {
    // The motivating case for Finding 1: on payday, everything is still
    // uncategorised (spec 2.2 — "nearly all of it" until phase 5). A salary
    // and a small same-day outflow must not net into one row, or Income and
    // Expenses collapse into a single signed figure.
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-1",
            "salary",
            "deposit",
            eur(3000),
            day(2026, 3, 4),
            "SALARY",
        ),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-1",
            "coffee",
            "withdrawal",
            eur(-4),
            day(2026, 3, 4),
            "COFFEE",
        ),
    )
    .await?;
    drop(conn);

    let rows = day_category_totals(&pool, user_id, day(2026, 3, 1), day(2026, 3, 31)).await?;
    assert_eq!(
        rows.len(),
        2,
        "the salary and the coffee must not net into one uncategorised row"
    );
    let income: Decimal = rows
        .iter()
        .filter(|r| r.amount > Decimal::ZERO)
        .map(|r| r.amount)
        .sum();
    let expense: Decimal = rows
        .iter()
        .filter(|r| r.amount < Decimal::ZERO)
        .map(|r| r.amount)
        .sum();
    assert_eq!(income, eur(3000));
    assert_eq!(expense, eur(-4));
    Ok(())
}

use gripsou_core::repo::query::{TransactionFilters, TypeBucket, transaction_counts, transactions};

fn filters() -> TransactionFilters {
    TransactionFilters {
        search: None,
        account_id: None,
        kind: None,
        bucket: TypeBucket::All,
        from: None,
        to: None,
        category_ids: vec![],
        tag_ids: vec![],
        uncategorized: false,
        needs_review: false,
        include_transfers: true,
        review_threshold: Decimal::new(80, 2),
        limit: 200,
        offset: 0,
    }
}

#[sqlx::test(migrations = "../migrations")]
async fn the_matching_total_converts_each_row_at_its_own_date(pool: PgPool) -> anyhow::Result<()> {
    let usd = cash_instrument(&pool, "USD").await;
    rate_on(&pool, usd, day(2026, 3, 1), Decimal::new(50, 2)).await;
    rate_on(&pool, usd, day(2026, 9, 1), Decimal::new(90, 2)).await;

    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let eur_acct = upsert_account(&mut conn, conn_id, &checking_account("acct-eur")).await?;
    let usd_acct =
        upsert_account(&mut conn, conn_id, &checking_account_in("acct-usd", "USD")).await?;
    upsert_transaction(
        &mut conn,
        eur_acct,
        &txn_on_day(
            "acct-eur",
            "t1",
            "withdrawal",
            eur(-10),
            day(2026, 3, 4),
            "EUR SPEND",
        ),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        usd_acct,
        &txn_on_day(
            "acct-usd",
            "t2",
            "withdrawal",
            eur(-100),
            day(2026, 3, 5),
            "US SPEND",
        ),
    )
    .await?;
    drop(conn);

    // -10 EUR, plus -100 USD at March's 0.50 = -50 EUR.
    let c = transaction_counts(&pool, user_id, &filters()).await?;
    assert_eq!(c.matching, 2);
    assert_eq!(c.matching_total, eur(-60));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn list_rows_carry_both_their_own_and_the_reporting_amount(
    pool: PgPool,
) -> anyhow::Result<()> {
    let usd = cash_instrument(&pool, "USD").await;
    rate_on(&pool, usd, day(2026, 3, 1), Decimal::new(50, 2)).await;

    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let usd_acct =
        upsert_account(&mut conn, conn_id, &checking_account_in("acct-usd", "USD")).await?;
    upsert_transaction(
        &mut conn,
        usd_acct,
        &txn_on_day(
            "acct-usd",
            "t1",
            "withdrawal",
            eur(-100),
            day(2026, 3, 4),
            "US SPEND",
        ),
    )
    .await?;
    drop(conn);

    let rows = transactions(&pool, user_id, &filters()).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].amount, eur(-100), "the list still shows what moved");
    assert_eq!(rows[0].amount_reporting, eur(-50));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn the_matching_total_respects_the_active_filters(pool: PgPool) -> anyhow::Result<()> {
    let (user_id, conn_id) = seed_user_and_connection(&pool).await;
    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-1",
            "t1",
            "withdrawal",
            eur(-10),
            day(2026, 3, 4),
            "KEEP",
        ),
    )
    .await?;
    upsert_transaction(
        &mut conn,
        account_id,
        &txn_on_day(
            "acct-1",
            "t2",
            "withdrawal",
            eur(-99),
            day(2026, 3, 5),
            "DROP",
        ),
    )
    .await?;
    drop(conn);

    let f = TransactionFilters {
        search: Some("KEEP".into()),
        ..filters()
    };
    let c = transaction_counts(&pool, user_id, &f).await?;
    assert_eq!(c.matching, 1);
    assert_eq!(
        c.matching_total,
        eur(-10),
        "the total tracks the same set as the count"
    );
    Ok(())
}
