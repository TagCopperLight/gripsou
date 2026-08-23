mod common;

use chrono::NaiveDate;
use common::{
    cash_holding, checking_account, equity_holding, holding_ids, insert_price_on, seed_connection,
    stamp_on,
};
use gripsou_core::backfill::backfill_connection;
use gripsou_core::dto::{Institution, SyncResult};
use gripsou_core::ingest::ingest;
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::holding::upsert_holding;
use gripsou_core::repo::instrument::resolve_instrument;
use gripsou_core::repo::query;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../migrations")]
async fn insert_price_is_upsert(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
            transactions: vec![],
        },
    )
    .await?;

    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'cash'")
            .fetch_one(&pool)
            .await?;
    let ts = chrono::Utc::now();

    insert_price_on(&pool, instrument_id, ts, Decimal::new(1, 0)).await;
    insert_price_on(&pool, instrument_id, ts, Decimal::new(2, 0)).await; // same ts → upsert

    let count: i64 = sqlx::query_scalar("select count(*) from price")
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        count, 1,
        "same (instrument, ts) upserts rather than duplicating"
    );
    let price: Decimal = sqlx::query_scalar("select unit_price from price")
        .fetch_one(&pool)
        .await?;
    assert_eq!(price, Decimal::new(2, 0));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn net_worth_series_groups_by_day(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    // This test is about day grouping, not currency: pin the equity to the
    // pivot so the numbers below are pure valuation arithmetic.
    let mut equity = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::new(3, 0),
        Decimal::new(450, 0),
        Some(Decimal::new(600, 0)),
    );
    equity.instrument.currency = "EUR".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0)), equity],
            transactions: vec![],
        },
    )
    .await?;

    let ids = holding_ids(&pool).await; // [Apple, Euro] by instrument name
    let (d1, d2) = (
        NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(),
    );
    // Day 1: apple value 600, cash 100 -> nw 700, invested 450+100
    stamp_on(
        &pool,
        ids[0],
        d1,
        Decimal::new(3, 0),
        Decimal::new(600, 0),
        Decimal::new(450, 0),
    )
    .await;
    stamp_on(
        &pool,
        ids[1],
        d1,
        Decimal::new(100, 0),
        Decimal::new(100, 0),
        Decimal::new(100, 0),
    )
    .await;
    // Day 2: apple value 630
    stamp_on(
        &pool,
        ids[0],
        d2,
        Decimal::new(3, 0),
        Decimal::new(630, 0),
        Decimal::new(450, 0),
    )
    .await;
    stamp_on(
        &pool,
        ids[1],
        d2,
        Decimal::new(100, 0),
        Decimal::new(100, 0),
        Decimal::new(100, 0),
    )
    .await;

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let rows = query::net_worth_series(&pool, user_id, d1, d2).await?;

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].as_of, d1);
    assert_eq!(rows[0].net_worth, Decimal::new(700, 0));
    assert_eq!(rows[0].invested, Decimal::new(550, 0));
    assert_eq!(rows[1].net_worth, Decimal::new(730, 0));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn net_worth_excludes_pre_acquisition_and_values_by_price(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Cash held on both days; the equity is acquired only on d1 (its first
    // snapshot is d1). A backfilled price exists on d0 too. The equity must NOT
    // contribute on d0 (no phantom holding before acquisition), and on d1 it
    // must be valued from the price series (qty x price), not snapshot.value.
    let conn_id = seed_connection(&pool).await;
    // This test is about pre-acquisition exclusion and price-driven valuation,
    // not currency: pin the equity to the pivot so the numbers below are pure
    // valuation arithmetic.
    let mut equity = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::new(3, 0),
        Decimal::new(450, 0),
        Some(Decimal::new(600, 0)),
    );
    equity.instrument.currency = "EUR".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0)), equity],
            transactions: vec![],
        },
    )
    .await?;

    let ids = holding_ids(&pool).await; // [Apple (equity), Euro (cash)] by name
    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind <> 'cash'")
            .fetch_one(&pool)
            .await?;
    let d0 = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    let d1 = NaiveDate::from_ymd_opt(2026, 1, 2).unwrap();
    let at = |d: NaiveDate| d.and_hms_opt(12, 0, 0).unwrap().and_utc();

    // Cash: present on both days. Equity: first snapshot is d1 only.
    stamp_on(
        &pool,
        ids[1],
        d0,
        Decimal::new(100, 0),
        Decimal::new(100, 0),
        Decimal::new(100, 0),
    )
    .await;
    stamp_on(
        &pool,
        ids[1],
        d1,
        Decimal::new(100, 0),
        Decimal::new(100, 0),
        Decimal::new(100, 0),
    )
    .await;
    stamp_on(
        &pool,
        ids[0],
        d1,
        Decimal::new(3, 0),
        Decimal::new(600, 0),
        Decimal::new(450, 0),
    )
    .await;
    // Price exists on both days; 210 differs from snapshot.value (600) so we can
    // tell price-based valuation (3*210=630) from snapshot-based (600).
    insert_price_on(&pool, instrument_id, at(d0), Decimal::new(210, 0)).await;
    insert_price_on(&pool, instrument_id, at(d1), Decimal::new(210, 0)).await;

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let rows = query::net_worth_series(&pool, user_id, d0, d1).await?;

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].as_of, d0);
    assert_eq!(
        rows[0].net_worth,
        Decimal::new(100, 0),
        "d0: cash only; equity not yet acquired must not appear"
    );
    assert_eq!(
        rows[0].invested,
        Decimal::new(100, 0),
        "d0: only cash cost basis"
    );
    assert_eq!(
        rows[1].net_worth,
        Decimal::new(730, 0),
        "d1: cash 100 + equity 3*210 (price-driven, not snapshot.value 600)"
    );
    assert_eq!(rows[1].invested, Decimal::new(550, 0), "d1: 100 + 450");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn distribution_sums_latest_snapshot_per_account(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
            transactions: vec![],
        },
    )
    .await?;
    let ids = holding_ids(&pool).await;
    let today = chrono::Utc::now().date_naive();
    let yesterday = today - chrono::Days::new(1);
    // stamp yesterday first (value 100), then overwrite today's ingest snapshot with value 120
    stamp_on(
        &pool,
        ids[0],
        yesterday,
        Decimal::new(100, 0),
        Decimal::new(100, 0),
        Decimal::new(100, 0),
    )
    .await;
    stamp_on(
        &pool,
        ids[0],
        today,
        Decimal::new(120, 0),
        Decimal::new(120, 0),
        Decimal::new(100, 0),
    )
    .await;

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let rows = query::distribution(&pool, user_id).await?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "Current account");
    // The account is `checking`; before the category table was dropped this
    // read "cash"/"Cash" via checking -> cash.
    assert_eq!(rows[0].type_key, "checking");
    assert_eq!(rows[0].type_label, "Checking");
    assert_eq!(
        rows[0].value,
        Decimal::new(120, 0),
        "uses the latest snapshot, not the first"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn holdings_join_latest_price_and_spark(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            transactions: vec![],
        },
    )
    .await?;
    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind <> 'cash'")
            .fetch_one(&pool)
            .await?;
    let base = chrono::Utc::now();
    insert_price_on(
        &pool,
        instrument_id,
        base - chrono::Duration::days(2),
        Decimal::new(190, 0),
    )
    .await;
    insert_price_on(
        &pool,
        instrument_id,
        base - chrono::Duration::days(1),
        Decimal::new(200, 0),
    )
    .await;

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let rows = query::holdings(&pool, user_id).await?;

    assert_eq!(rows.len(), 1);
    let r = &rows[0];
    assert_eq!(r.kind, "equity");
    assert_eq!(r.price, Some(Decimal::new(200, 0)), "latest price wins");
    assert_eq!(
        r.spark,
        vec![Decimal::new(190, 0), Decimal::new(200, 0)],
        "ascending by time"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn holdings_excludes_closed_zero_quantity(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    // First sync: cash + equity.
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![
                cash_holding("acct-1", Decimal::new(100, 0)),
                equity_holding(
                    "acct-1",
                    "US0378331005",
                    Decimal::new(3, 0),
                    Decimal::new(450, 0),
                    Some(Decimal::new(600, 0)),
                ),
            ],
            transactions: vec![],
        },
    )
    .await?;
    // Second sync drops the cash holding, so it is closed (quantity 0).
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            transactions: vec![],
        },
    )
    .await?;

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let rows = query::holdings(&pool, user_id).await?;
    assert_eq!(
        rows.len(),
        1,
        "closed (zero-quantity) holdings are excluded"
    );
    assert_eq!(rows[0].kind, "equity");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn holding_prices_windowed_and_owned(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            transactions: vec![],
        },
    )
    .await?;
    let holding_id = holding_ids(&pool).await[0];
    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind <> 'cash'")
            .fetch_one(&pool)
            .await?;
    let base = chrono::Utc::now();
    insert_price_on(
        &pool,
        instrument_id,
        base - chrono::Duration::days(10),
        Decimal::new(150, 0),
    )
    .await; // outside window
    insert_price_on(
        &pool,
        instrument_id,
        base - chrono::Duration::days(1),
        Decimal::new(200, 0),
    )
    .await; // inside

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let from = base - chrono::Duration::days(3);
    let prices = query::holding_prices(&pool, user_id, holding_id, from, base).await?;
    assert_eq!(prices.len(), 1);
    assert_eq!(prices[0].unit_price, Decimal::new(200, 0));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn accounts_lists_latest_value_and_type(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
            transactions: vec![],
        },
    )
    .await?;
    let ids = holding_ids(&pool).await;
    let today = chrono::Utc::now().date_naive();
    stamp_on(
        &pool,
        ids[0],
        today,
        Decimal::new(150, 0),
        Decimal::new(150, 0),
        Decimal::new(100, 0),
    )
    .await;

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let rows = query::accounts(&pool, user_id).await?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "Current account");
    assert_eq!(rows[0].type_label, "Checking");
    assert_eq!(rows[0].value, Decimal::new(150, 0));
    assert!(
        rows[0].last_sync_at.is_none(),
        "test connection never synced"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn accounts_and_distribution_value_equity_by_price(pool: PgPool) -> anyhow::Result<()> {
    // The accounts grid and the distribution pie must value an equity from the
    // price series (so they sum to the net-worth figure), not from the provider
    // valuation stored in snapshot.value.
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)), // provider valuation -> snapshot.value
            )],
            transactions: vec![],
        },
    )
    .await?;
    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind <> 'cash'")
            .fetch_one(&pool)
            .await?;
    // A price today (210) differs from the snapshot value (600); 3*210 = 630.
    insert_price_on(
        &pool,
        instrument_id,
        chrono::Utc::now(),
        Decimal::new(210, 0),
    )
    .await;

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;

    let accts = query::accounts(&pool, user_id).await?;
    assert_eq!(accts.len(), 1);
    assert_eq!(
        accts[0].value,
        Decimal::new(630, 0),
        "accounts: equity valued by price (3*210), not snapshot.value 600"
    );

    let dist = query::distribution(&pool, user_id).await?;
    let total: Decimal = dist.iter().map(|r| r.value).sum();
    assert_eq!(
        total,
        Decimal::new(630, 0),
        "distribution: same price-based value"
    );
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn account_series_groups_by_account_and_day(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1"), checking_account("acct-2")],
            holdings: vec![
                cash_holding("acct-1", Decimal::new(100, 0)),
                cash_holding("acct-2", Decimal::new(200, 0)),
            ],
            transactions: vec![],
        },
    )
    .await?;

    // Map each account's cash holding id via account.external_id.
    let pairs: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "select h.id, a.external_id from holding h join account a on a.id = h.account_id",
    )
    .fetch_all(&pool)
    .await?;
    let day = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    for (hid, ext) in &pairs {
        let v = if ext == "acct-1" { 100 } else { 200 };
        stamp_on(
            &pool,
            *hid,
            day,
            Decimal::new(v, 0),
            Decimal::new(v, 0),
            Decimal::new(v, 0),
        )
        .await;
    }

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let rows = query::account_series(&pool, user_id, day, day).await?;

    assert_eq!(rows.len(), 2, "one row per (account, day)");
    let total: Decimal = rows.iter().map(|r| r.value).sum();
    assert_eq!(total, Decimal::new(300, 0));
    let distinct: std::collections::HashSet<_> = rows.iter().map(|r| r.account_id).collect();
    assert_eq!(distinct.len(), 2, "grouped per account");
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn holding_transactions_returns_buy_lots(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            transactions: vec![],
        },
    )
    .await?;
    let account_id: uuid::Uuid = sqlx::query_scalar("select id from account")
        .fetch_one(&pool)
        .await?;
    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind <> 'cash'")
            .fetch_one(&pool)
            .await?;
    // Seed a buy lot directly (the seed binary will do likewise, with instrument_id set).
    sqlx::query("insert into transaction (account_id, instrument_id, ts, type, quantity, unit_price, amount) values ($1, $2, now(), 'buy', 3, 150, 450)")
        .bind(account_id).bind(instrument_id).execute(&pool).await?;
    let holding_id = holding_ids(&pool).await[0];

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let txns = query::holding_transactions(&pool, user_id, holding_id).await?;
    assert_eq!(txns.len(), 1);
    assert_eq!(txns[0].quantity, Some(Decimal::new(3, 0)));
    assert_eq!(txns[0].amount, Decimal::new(450, 0));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn holdings_includes_composition_when_present(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            transactions: vec![],
        },
    )
    .await?;

    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind <> 'cash'")
            .fetch_one(&pool)
            .await?;

    sqlx::query!(
        r#"update instrument set kind='etf',
           meta = jsonb_set('{}'::jsonb, '{composition}',
             '{"countries":[{"name":"USA","weight":0.6}],"sectors":[]}'::jsonb)
           where id = $1"#,
        instrument_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_id: uuid::Uuid = sqlx::query_scalar("select user_id from connection")
        .fetch_one(&pool)
        .await?;
    let rows = query::holdings(&pool, user_id).await?;
    let etf = rows.iter().find(|r| r.kind == "etf").unwrap();
    let comp = etf.composition.as_ref().unwrap();
    assert_eq!(comp.countries[0].name, "USA");
    assert!((comp.countries[0].weight - 0.6).abs() < 1e-10);
    assert!(comp.sectors.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn account_types_returns_seeded_reference(pool: PgPool) -> anyhow::Result<()> {
    let types = query::account_types(&pool).await?;
    let keys: Vec<&str> = types.iter().map(|t| t.key.as_str()).collect();
    assert!(keys.contains(&"checking"));
    assert!(keys.contains(&"brokerage"));
    assert!(keys.contains(&"life_insurance"));
    assert!(keys.contains(&"retirement"));
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn net_worth_converts_foreign_cash_and_flags_a_missing_rate(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut cny_account = checking_account("acct-cny");
    cny_account.currency = "CNY".to_string();
    let mut cny_cash = cash_holding("acct-cny", Decimal::new(1000, 0));
    cny_cash.instrument.currency = "CNY".to_string();
    cny_cash.instrument.name = "Yuan".to_string();

    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![cny_account],
            holdings: vec![cny_cash],
            transactions: vec![],
        },
    )
    .await?;

    let today = chrono::Utc::now().date_naive();

    // No rate yet: the holding is worth zero and the day is flagged.
    let rows = query::net_worth_series(&pool, user_of(&pool, conn_id).await?, today, today).await?;
    assert_eq!(rows[0].net_worth, Decimal::ZERO, "no rate → not counted");
    assert!(rows[0].fx_missing, "and the UI must be told");

    // With a rate, 1000 CNY is 120 EUR.
    let cny_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'cash' and currency = 'CNY'")
            .fetch_one(&pool)
            .await?;
    insert_price_on(&pool, cny_id, chrono::Utc::now(), "0.12".parse()?).await;

    let rows = query::net_worth_series(&pool, user_of(&pool, conn_id).await?, today, today).await?;
    assert_eq!(rows[0].net_worth, "120.00".parse()?);
    assert!(!rows[0].fx_missing);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn net_worth_divides_into_the_reporting_currency(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = user_of(&pool, conn_id).await?;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
            transactions: vec![],
        },
    )
    .await?;

    // 100 EUR reported in USD at 0.80 EUR per USD = 125 USD.
    let usd: uuid::Uuid = sqlx::query_scalar(
        "insert into instrument (kind, name, currency) values ('cash', 'Dollar', 'USD') returning id",
    )
    .fetch_one(&pool)
    .await?;
    insert_price_on(&pool, usd, chrono::Utc::now(), "0.80".parse()?).await;
    sqlx::query("update users set prefs = jsonb_set(prefs, '{currency}', '\"USD\"') where id = $1")
        .bind(user_id)
        .execute(&pool)
        .await?;

    let today = chrono::Utc::now().date_naive();
    let rows = query::net_worth_series(&pool, user_id, today, today).await?;
    assert_eq!(rows[0].net_worth, "125".parse()?);
    Ok(())
}

/// The user owning a connection.
async fn user_of(pool: &PgPool, conn_id: uuid::Uuid) -> anyhow::Result<uuid::Uuid> {
    Ok(
        sqlx::query_scalar("select user_id from connection where id = $1")
            .bind(conn_id)
            .fetch_one(pool)
            .await?,
    )
}

#[sqlx::test(migrations = "../migrations")]
async fn holdings_report_converted_value_and_native_price(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = user_of(&pool, conn_id).await?;
    let mut equity = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::new(10, 0),
        Decimal::new(1500, 0),
        None,
    );
    equity.instrument.currency = "USD".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity],
            transactions: vec![],
        },
    )
    .await?;

    // Price 200 USD, rate 0.90 EUR per USD.
    let usd: uuid::Uuid = sqlx::query_scalar(
        "insert into instrument (kind, name, currency) values ('cash', 'Dollar', 'USD') returning id",
    )
    .fetch_one(&pool)
    .await?;
    let equity_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'equity'")
            .fetch_one(&pool)
            .await?;
    let mut conn = pool.acquire().await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        usd,
        chrono::Utc::now(),
        "0.90".parse()?,
        "EUR",
    )
    .await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        equity_id,
        chrono::Utc::now(),
        "200".parse()?,
        "USD",
    )
    .await?;

    let rows = query::holdings(&pool, user_id).await?;
    let h = rows.iter().find(|r| r.kind == "equity").unwrap();
    assert_eq!(
        h.price,
        Some("200".parse()?),
        "unit price stays in the price row's own currency (USD)"
    );
    assert_eq!(h.price_currency.as_deref(), Some("USD"));
    assert_eq!(h.currency, "USD", "the instrument's quote currency");
    assert_eq!(h.account_currency, "EUR");
    assert_eq!(
        h.value,
        "1800.00".parse()?,
        "10 * 200 USD * 0.90 = 1800 EUR"
    );
    // cost_basis is amount-domain: the provider denominated it in the ACCOUNT's
    // currency (EUR), so it converts at 1 — multiplying it by the USD rate, as
    // the code used to, understated invested by ~14% and inflated gain %.
    assert_eq!(h.invested, "1500".parse()?, "1500 is already EUR");
    assert_eq!(h.invested_native, "1500".parse()?);
    assert!(!h.fx_missing);
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn holdings_flag_and_zero_an_unconvertible_position(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = user_of(&pool, conn_id).await?;
    // The account must be CNY too: `holding_snapshot.value` is denominated in the
    // account's currency, so a CNY cash position inside a EUR account would mean
    // the provider valued it in EUR — convertible, and rightly not flagged.
    let mut cny_account = checking_account("acct-1");
    cny_account.currency = "CNY".to_string();
    let mut cny_cash = cash_holding("acct-1", Decimal::new(1000, 0));
    cny_cash.instrument.currency = "CNY".to_string();
    cny_cash.instrument.name = "Yuan".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![cny_account],
            holdings: vec![cny_cash],
            transactions: vec![],
        },
    )
    .await?;

    let rows = query::holdings(&pool, user_id).await?;
    let h = &rows[0];
    assert_eq!(h.value, Decimal::ZERO);
    assert!(h.fx_missing);
    assert_eq!(h.quantity, Decimal::new(1000, 0), "the position is intact");
    Ok(())
}

/// All four valuation paths (holdings, accounts, distribution, net_worth_series)
/// must sum to the exact same figure for the same portfolio: one EUR cash
/// position, one CNY cash position with a seeded rate, a USD equity with a
/// seeded price and rate, and — crucially — one equity with NO price row at all
/// and a nonzero snapshot value, which can only be valued through the
/// provider-valuation fallback. That last one is what proves `holdings()` shares
/// the fallback: without it, the holdings table showed 0 while the accounts
/// card, the pie and the net-worth chart all showed the provider valuation, on
/// the same screen. If these ever disagree it means a second, divergent
/// valuation path crept back in.
#[sqlx::test(migrations = "../migrations")]
async fn all_valuation_paths_agree(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = user_of(&pool, conn_id).await?;

    let mut cny_cash = cash_holding("acct-1", Decimal::new(1000, 0));
    cny_cash.instrument.currency = "CNY".to_string();
    cny_cash.instrument.name = "Yuan".to_string();

    let mut equity = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::new(10, 0),
        Decimal::new(1500, 0),
        None,
    );
    equity.instrument.currency = "USD".to_string();

    // No price will ever be inserted for this one, so `unit_value_asof` is NULL
    // and only the snapshot fallback can value it.
    let mut unpriced = equity_holding(
        "acct-1",
        "FR0000120271",
        Decimal::new(5, 0),
        Decimal::new(300, 0),
        None,
    );
    unpriced.instrument.name = "Unpriced SA".to_string();
    unpriced.instrument.symbol = Some("UNPR".to_string());
    unpriced.instrument.currency = "USD".to_string();

    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![
                cash_holding("acct-1", Decimal::new(100, 0)),
                cny_cash,
                equity,
                unpriced,
            ],
            transactions: vec![],
        },
    )
    .await?;

    let usd: uuid::Uuid = sqlx::query_scalar(
        "insert into instrument (kind, name, currency) values ('cash', 'Dollar', 'USD') returning id",
    )
    .fetch_one(&pool)
    .await?;
    let cny_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'cash' and currency = 'CNY'")
            .fetch_one(&pool)
            .await?;
    // By ISIN, not just `kind = 'equity'`: there are two equities here and only
    // this one may get a price row — the other must stay unpriced so the
    // snapshot fallback is the thing under test. Without the filter the row
    // picked is arbitrary and the test is flaky by construction.
    let equity_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where isin = 'US0378331005'")
            .fetch_one(&pool)
            .await?;
    let mut conn = pool.acquire().await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        usd,
        chrono::Utc::now(),
        "0.90".parse()?,
        "EUR",
    )
    .await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        cny_id,
        chrono::Utc::now(),
        "0.12".parse()?,
        "EUR",
    )
    .await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        equity_id,
        chrono::Utc::now(),
        "200".parse()?,
        "USD",
    )
    .await?;
    drop(conn);

    // Snapshots are what net_worth_series/accounts/distribution read from (and
    // now holdings() too, for its fallback); stamp today's for each holding.
    // Every priced holding gets value 0 so that a path accidentally reading
    // snapshot.value instead of the price would show up immediately; the
    // unpriced one gets a real provider valuation of 400, which is the only way
    // it can be valued at all.
    let today = chrono::Utc::now().date_naive();
    let rows: Vec<(uuid::Uuid, String, Decimal, Decimal)> = sqlx::query_as(
        "select h.id, i.name, h.quantity, h.cost_basis
         from holding h join instrument i on i.id = h.instrument_id",
    )
    .fetch_all(&pool)
    .await?;
    for (holding_id, name, qty, cost) in rows {
        let value = if name == "Unpriced SA" {
            Decimal::new(400, 0)
        } else {
            Decimal::ZERO
        };
        stamp_on(&pool, holding_id, today, qty, value, cost).await;
    }

    let holdings_total: Decimal = query::holdings(&pool, user_id)
        .await?
        .iter()
        .map(|r| r.value)
        .sum();
    let accounts_total: Decimal = query::accounts(&pool, user_id)
        .await?
        .iter()
        .map(|r| r.value)
        .sum();
    let distribution_total: Decimal = query::distribution(&pool, user_id)
        .await?
        .iter()
        .map(|r| r.value)
        .sum();
    let net_worth_rows = query::net_worth_series(&pool, user_id, today, today).await?;
    let net_worth_total = net_worth_rows[0].net_worth;

    assert_eq!(holdings_total, accounts_total, "holdings vs accounts");
    assert_eq!(
        accounts_total, distribution_total,
        "accounts vs distribution"
    );
    assert_eq!(
        distribution_total, net_worth_total,
        "distribution vs net_worth_series"
    );
    // 100 EUR cash + 1000 CNY x 0.12 + 10 x 200 USD x 0.90 + the unpriced
    // position's provider valuation of 400, which is denominated in the ACCOUNT's
    // currency (EUR) and so converts at 1 — not at the USD rate the instrument's
    // quote currency would have suggested (that would give 360).
    assert_eq!(
        net_worth_total,
        "2420.00".parse()?,
        "100 + 120 + 1800 + 400 (fallback converted from the account currency)"
    );
    // And the unpriced holding is not silently zeroed in the holdings table.
    let unpriced = query::holdings(&pool, user_id)
        .await?
        .into_iter()
        .find(|r| r.instrument_name == "Unpriced SA")
        .expect("unpriced holding is listed");
    assert_eq!(
        unpriced.value,
        Decimal::new(400, 0),
        "holdings() shares the provider-valuation fallback"
    );
    assert!(
        !unpriced.fx_missing,
        "the fallback resolved, so nothing is missing"
    );
    Ok(())
}

/// A holding with neither a usable price nor a convertible snapshot value is
/// zeroed AND flagged — and the flag keys on that failure, not on the
/// instrument's quote currency. Here the instrument is labelled EUR (a rate that
/// trivially exists) while its only price row is quoted in GBP (no rate), which
/// is exactly the case the old `fx_asof(i.currency)` flag missed: value 0, no
/// warning.
#[sqlx::test(migrations = "../migrations")]
async fn a_price_in_an_unrated_currency_is_zeroed_and_flagged(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = user_of(&pool, conn_id).await?;
    let mut equity = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::new(10, 0),
        Decimal::new(1500, 0),
        None,
    );
    // Powens says EUR; Yahoo will resolve a London listing quoted GBP.
    equity.instrument.currency = "EUR".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity],
            transactions: vec![],
        },
    )
    .await?;

    let equity_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'equity'")
            .fetch_one(&pool)
            .await?;
    let mut conn = pool.acquire().await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        equity_id,
        chrono::Utc::now(),
        "150".parse()?,
        "GBP",
    )
    .await?;
    drop(conn);

    let h = query::holdings(&pool, user_id)
        .await?
        .into_iter()
        .find(|r| r.kind == "equity")
        .unwrap();
    assert_eq!(h.value, Decimal::ZERO, "no GBP rate → not counted");
    assert!(
        h.fx_missing,
        "and the UI must be told, even though i.currency = EUR has a rate"
    );
    assert_eq!(
        h.price_currency.as_deref(),
        Some("GBP"),
        "the price row's own"
    );
    assert_eq!(
        h.currency, "EUR",
        "the instrument's quote currency, unchanged"
    );
    assert_eq!(h.account_currency, "EUR");
    Ok(())
}

/// GBP here is reachable only through `price.currency` — no holding is
/// denominated in it — so neither the cash-instrument backfill nor the
/// eligibility union may key off `instrument.currency` alone, or the rate can
/// never arrive and the position above stays zero forever.
#[sqlx::test(migrations = "../migrations")]
async fn a_price_row_currency_becomes_price_eligible(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut equity = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::new(10, 0),
        Decimal::new(1500, 0),
        None,
    );
    equity.instrument.currency = "EUR".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity],
            transactions: vec![],
        },
    )
    .await?;
    let equity_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'equity'")
            .fetch_one(&pool)
            .await?;
    let mut conn = pool.acquire().await?;
    gripsou_core::repo::price::insert_price(
        &mut conn,
        equity_id,
        chrono::Utc::now(),
        "150".parse()?,
        "GBP",
    )
    .await?;
    drop(conn);

    gripsou_core::price_sync::fetch_prices_for_connection(&pool, conn_id, &[]).await?;

    let gbp: Option<uuid::Uuid> =
        sqlx::query_scalar("select id from instrument where kind = 'cash' and currency = 'GBP'")
            .fetch_optional(&pool)
            .await?;
    assert!(gbp.is_some(), "a GBP cash instrument now carries the rate");

    let eligible = query::price_eligible_instruments_for_connection(&pool, conn_id).await?;
    assert!(
        eligible
            .iter()
            .any(|r| r.kind == "cash" && r.currency == "GBP"),
        "and it is offered to the price-fetch pass"
    );
    Ok(())
}

/// A provider's malformed currency string must never become a globally-shared
/// cash instrument (the `kind='cash'` unique index on `currency` would happily
/// hold both "USD" and "usd") nor reach a live Yahoo URL.
#[sqlx::test(migrations = "../migrations")]
async fn a_malformed_currency_never_becomes_a_cash_instrument(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut equity = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::new(10, 0),
        Decimal::new(1500, 0),
        None,
    );
    equity.instrument.currency = "usd".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            institution: Institution::default(),
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity],
            transactions: vec![],
        },
    )
    .await?;

    gripsou_core::price_sync::fetch_prices_for_connection(&pool, conn_id, &[]).await?;

    let cash_currencies: Vec<String> =
        sqlx::query_scalar("select currency from instrument where kind = 'cash'")
            .fetch_all(&pool)
            .await?;
    assert!(
        !cash_currencies.iter().any(|c| c == "usd"),
        "lowercase 'usd' rejected, got {cash_currencies:?}"
    );
    Ok(())
}

/// A derived row is a first-class point on the chart: net worth on a day with
/// no snapshot comes from the backfill rather than from the older snapshot.
#[sqlx::test(migrations = "../migrations")]
async fn net_worth_reads_derived_history(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let instrument_id = resolve_instrument(
        &mut conn,
        &gripsou_core::dto::InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: "Euro".into(),
            currency: "EUR".into(),
        },
    )
    .await?;
    let holding_id = upsert_holding(
        &mut conn,
        account_id,
        instrument_id,
        &cash_holding("acct-1", Decimal::new(10000, 2)),
    )
    .await?;

    let anchor = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    let derived_day = NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    stamp_on(
        &pool,
        holding_id,
        anchor,
        Decimal::new(10000, 2),
        Decimal::new(10000, 2),
        Decimal::new(10000, 2),
    )
    .await;
    sqlx::query(
        "insert into holding_backfill (holding_id, as_of, quantity, value, cost_basis) \
         values ($1, $2, 75, 75, 75)",
    )
    .bind(holding_id)
    .bind(derived_day)
    .execute(&pool)
    .await?;

    let rows = query::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Decimal::new(75, 0),
        "derived quantity drives the point"
    );
    Ok(())
}

/// Seed one equity holding with a single snapshot on `anchor`, run the
/// backfill, and return (user_id, instrument_id). The derived day is
/// `anchor - 1`: the backfill horizon reaches one day past the earliest
/// evidence, and days after the last snapshot have no anchor to walk from.
async fn seed_backfilled_equity(
    pool: &PgPool,
    anchor: NaiveDate,
    valuation: Decimal,
) -> anyhow::Result<(Uuid, Uuid)> {
    let conn_id = seed_connection(pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(pool)
        .await?;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let holding = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::new(10, 0),
        Decimal::new(1000, 0),
        Some(valuation),
    );
    let instrument_id = resolve_instrument(&mut conn, &holding.instrument).await?;
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &holding).await?;
    stamp_on(
        pool,
        holding_id,
        anchor,
        Decimal::new(10, 0),
        valuation,
        Decimal::new(1000, 0),
    )
    .await;

    backfill_connection(&mut conn, conn_id).await?;
    Ok((user_id, instrument_id))
}

/// A security with no price row at all is valued on derived days by carrying
/// the anchor snapshot's unit valuation flat backward (§3 rule 3 applied to
/// price). Without that the chart would dip to zero on every derived day and
/// spuriously raise fx_missing.
#[sqlx::test(migrations = "../migrations")]
async fn a_priceless_security_keeps_its_valuation_on_derived_days(
    pool: PgPool,
) -> anyhow::Result<()> {
    let anchor = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    let derived_day = NaiveDate::from_ymd_opt(2026, 1, 9).unwrap();
    let (user_id, _) = seed_backfilled_equity(&pool, anchor, Decimal::new(1200, 0)).await?;

    let rows = query::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Decimal::new(1200, 0),
        "the anchor's unit valuation is carried flat backward, not zeroed"
    );
    assert!(
        !on_derived.fx_missing,
        "a valued derived day must not raise the missing-rate warning"
    );
    Ok(())
}

/// The priced path is untouched: when a price exists, quantity × unit_value_asof
/// wins and the backfill's stored `value` is never consulted.
#[sqlx::test(migrations = "../migrations")]
async fn a_priced_security_is_valued_from_the_price_on_derived_days(
    pool: PgPool,
) -> anyhow::Result<()> {
    let anchor = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    let derived_day = NaiveDate::from_ymd_opt(2026, 1, 9).unwrap();
    // Provider valuation (1200) deliberately disagrees with the price (100/unit
    // × 10 = 1000) so the assertion can only pass via the primary branch.
    let (user_id, instrument_id) =
        seed_backfilled_equity(&pool, anchor, Decimal::new(1200, 0)).await?;
    insert_price_on(
        &pool,
        instrument_id,
        derived_day.and_hms_opt(12, 0, 0).unwrap().and_utc(),
        Decimal::new(100, 0),
    )
    .await;

    let rows = query::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Decimal::new(1000, 0),
        "the price wins over the carried valuation"
    );
    Ok(())
}

/// Seed one equity holding that was fully sold: a valued snapshot on `held_day`,
/// a sell of the whole position on `sell_day`, and a zero-quantity snapshot on
/// `anchor`. Returns (user_id, holding_id).
async fn seed_sold_equity(
    pool: &PgPool,
    held_day: Option<(NaiveDate, Decimal, Decimal)>,
    sell_day: NaiveDate,
    anchor: NaiveDate,
    cost_basis: Decimal,
) -> anyhow::Result<Uuid> {
    let conn_id = seed_connection(pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(pool)
        .await?;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let holding = equity_holding(
        "acct-1",
        "US0378331005",
        Decimal::ZERO,
        cost_basis,
        Some(Decimal::ZERO),
    );
    let instrument_id = resolve_instrument(&mut conn, &holding.instrument).await?;
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &holding).await?;

    if let Some((day, qty, value)) = held_day {
        stamp_on(pool, holding_id, day, qty, value, cost_basis).await;
    }
    sqlx::query(
        "insert into transaction \
             (account_id, instrument_id, ts, type, quantity, unit_price, amount, external_id) \
         values ($1, $2, $3, 'sell', 10, 120, 1200, 'sell-1')",
    )
    .bind(account_id)
    .bind(instrument_id)
    .bind(sell_day.and_hms_opt(12, 0, 0).unwrap().and_utc())
    .execute(pool)
    .await?;
    stamp_on(
        pool,
        holding_id,
        anchor,
        Decimal::ZERO,
        Decimal::ZERO,
        cost_basis,
    )
    .await;

    backfill_connection(&mut conn, conn_id).await?;
    Ok(user_id)
}

/// A fully-sold priceless security: every *later* snapshot has quantity zero, so
/// the per-unit valuation has to be found by looking backward. Without that the
/// chart dips to zero across exactly the window the position was held.
#[sqlx::test(migrations = "../migrations")]
async fn a_fully_sold_priceless_security_keeps_its_held_window_valued(
    pool: PgPool,
) -> anyhow::Result<()> {
    let held = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    let derived_day = NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    let sell_day = NaiveDate::from_ymd_opt(2026, 1, 7).unwrap();
    let anchor = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    let user_id = seed_sold_equity(
        &pool,
        Some((held, Decimal::new(10, 0), Decimal::new(1200, 0))),
        sell_day,
        anchor,
        Decimal::new(1000, 0),
    )
    .await?;

    let rows = query::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Decimal::new(1200, 0),
        "the last valued snapshot's unit value is carried forward into the held window"
    );
    assert!(
        !on_derived.fx_missing,
        "a valued derived day must not raise the missing-rate warning"
    );
    Ok(())
}

/// No snapshot anywhere carries a non-zero quantity, so no per-unit valuation
/// exists at all: the derived row falls back to its own cost basis rather than
/// to zero.
#[sqlx::test(migrations = "../migrations")]
async fn a_priceless_security_with_no_valued_snapshot_falls_back_to_cost_basis(
    pool: PgPool,
) -> anyhow::Result<()> {
    // With no earlier snapshot the horizon starts one day before the sell, so
    // that is the only derived day on which the position is still held.
    let derived_day = NaiveDate::from_ymd_opt(2026, 1, 6).unwrap();
    let sell_day = NaiveDate::from_ymd_opt(2026, 1, 7).unwrap();
    let anchor = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    let user_id = seed_sold_equity(&pool, None, sell_day, anchor, Decimal::new(1000, 0)).await?;

    let rows = query::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Decimal::new(1000, 0),
        "with no market value available the row is valued at cost"
    );
    assert!(
        !on_derived.fx_missing,
        "a valued derived day must not raise the missing-rate warning"
    );
    Ok(())
}

/// The production gap shape: a derived day sitting *between* two snapshots must
/// read the derived row, not the older snapshot carried forward.
#[sqlx::test(migrations = "../migrations")]
async fn net_worth_prefers_the_derived_row_inside_a_gap(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let instrument_id = resolve_instrument(
        &mut conn,
        &gripsou_core::dto::InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: "Euro".into(),
            currency: "EUR".into(),
        },
    )
    .await?;
    let holding_id = upsert_holding(
        &mut conn,
        account_id,
        instrument_id,
        &cash_holding("acct-1", Decimal::new(30000, 2)),
    )
    .await?;

    let d1 = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    let d5 = NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
    let d10 = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    stamp_on(
        &pool,
        holding_id,
        d1,
        Decimal::new(100, 0),
        Decimal::new(100, 0),
        Decimal::new(100, 0),
    )
    .await;
    stamp_on(
        &pool,
        holding_id,
        d10,
        Decimal::new(300, 0),
        Decimal::new(300, 0),
        Decimal::new(300, 0),
    )
    .await;
    sqlx::query(
        "insert into holding_backfill (holding_id, as_of, quantity, value, cost_basis) \
         values ($1, $2, 200, 200, 200)",
    )
    .bind(holding_id)
    .bind(d5)
    .execute(&pool)
    .await?;

    let rows = query::net_worth_series(&pool, user_id, d1, d10).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == d5)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Decimal::new(200, 0),
        "the derived row wins over the older snapshot carried forward"
    );
    Ok(())
}

/// §9.1: a security position no lot explains is what the badge keys off.
#[sqlx::test(migrations = "../migrations")]
async fn reports_unexplained_quantity_per_holding(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let h = equity_holding(
        "acct-1",
        "IE0001",
        Decimal::new(100, 0),
        Decimal::new(1000, 0),
        Some(Decimal::new(1200, 0)),
    );
    let instrument_id = resolve_instrument(&mut conn, &h.instrument).await?;
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &h).await?;
    stamp_on(
        &pool,
        holding_id,
        chrono::Utc::now().date_naive(),
        h.quantity,
        Decimal::new(1200, 0),
        h.cost_basis,
    )
    .await;

    // 30 of the 100 shares are explained by a lot.
    sqlx::query(
        "insert into transaction (account_id, instrument_id, ts, type, quantity, unit_price, amount) \
         values ($1, $2, now(), 'buy', 30, 10, -300)",
    )
    .bind(account_id)
    .bind(instrument_id)
    .execute(&pool)
    .await?;

    let rows = query::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(row.unexplained_quantity, Decimal::new(70, 0));
    Ok(())
}

/// A fully explained position reports zero, not a negative shortfall.
#[sqlx::test(migrations = "../migrations")]
async fn a_fully_explained_holding_reports_zero(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let h = equity_holding(
        "acct-1",
        "IE0002",
        Decimal::new(30, 0),
        Decimal::new(300, 0),
        Some(Decimal::new(300, 0)),
    );
    let instrument_id = resolve_instrument(&mut conn, &h.instrument).await?;
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &h).await?;
    stamp_on(
        &pool,
        holding_id,
        chrono::Utc::now().date_naive(),
        h.quantity,
        Decimal::new(300, 0),
        h.cost_basis,
    )
    .await;
    sqlx::query(
        "insert into transaction (account_id, instrument_id, ts, type, quantity, unit_price, amount) \
         values ($1, $2, now(), 'buy', 30, 10, -300)",
    )
    .bind(account_id)
    .bind(instrument_id)
    .execute(&pool)
    .await?;

    let rows = query::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(row.unexplained_quantity, Decimal::ZERO);
    Ok(())
}

/// An over-explained position (recorded buys exceeding the current quantity —
/// realistic after a partial sale that was never recorded) must floor at
/// zero, not go negative. `a_fully_explained_holding_reports_zero` alone
/// cannot catch a missing `greatest(…, 0)` floor because its buys exactly
/// equal the quantity.
#[sqlx::test(migrations = "../migrations")]
async fn an_over_explained_holding_floors_at_zero(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let h = equity_holding(
        "acct-1",
        "IE0006",
        Decimal::new(30, 0),
        Decimal::new(300, 0),
        Some(Decimal::new(300, 0)),
    );
    let instrument_id = resolve_instrument(&mut conn, &h.instrument).await?;
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &h).await?;
    stamp_on(
        &pool,
        holding_id,
        chrono::Utc::now().date_naive(),
        h.quantity,
        Decimal::new(300, 0),
        h.cost_basis,
    )
    .await;
    // 50 recorded buys against a 30-share holding — a sale must have gone
    // unrecorded.
    sqlx::query(
        "insert into transaction (account_id, instrument_id, ts, type, quantity, unit_price, amount) \
         values ($1, $2, now(), 'buy', 50, 10, -500)",
    )
    .bind(account_id)
    .bind(instrument_id)
    .execute(&pool)
    .await?;

    let rows = query::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(
        row.unexplained_quantity,
        Decimal::ZERO,
        "over-explained must floor at zero, never go negative"
    );
    Ok(())
}

/// A holding with both buys and sells recorded must compute
/// `quantity − Σbuys + Σsells`, exercising the `sell` branch of the case
/// expression that no other test touches.
#[sqlx::test(migrations = "../migrations")]
async fn a_sell_increases_the_unexplained_quantity(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let h = equity_holding(
        "acct-1",
        "IE0007",
        Decimal::new(100, 0),
        Decimal::new(1000, 0),
        Some(Decimal::new(1200, 0)),
    );
    let instrument_id = resolve_instrument(&mut conn, &h.instrument).await?;
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &h).await?;
    stamp_on(
        &pool,
        holding_id,
        chrono::Utc::now().date_naive(),
        h.quantity,
        Decimal::new(1200, 0),
        h.cost_basis,
    )
    .await;
    // Bought 80, sold 20: 100 − 80 + 20 = 40 unexplained.
    sqlx::query(
        "insert into transaction (account_id, instrument_id, ts, type, quantity, unit_price, amount) \
         values ($1, $2, now(), 'buy', 80, 10, -800)",
    )
    .bind(account_id)
    .bind(instrument_id)
    .execute(&pool)
    .await?;
    sqlx::query(
        "insert into transaction (account_id, instrument_id, ts, type, quantity, unit_price, amount) \
         values ($1, $2, now(), 'sell', 20, 10, 200)",
    )
    .bind(account_id)
    .bind(instrument_id)
    .execute(&pool)
    .await?;

    let rows = query::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(
        row.unexplained_quantity,
        Decimal::new(40, 0),
        "100 − 80 (buys) + 20 (sells) = 40"
    );
    Ok(())
}

/// Cash has nothing to explain regardless of transaction history.
#[sqlx::test(migrations = "../migrations")]
async fn cash_is_never_unexplained(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_id)
        .fetch_one(&pool)
        .await?;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let instrument_id = resolve_instrument(
        &mut conn,
        &gripsou_core::dto::InstrumentRef {
            kind: "cash".into(),
            symbol: None,
            isin: None,
            name: "Euro".into(),
            currency: "EUR".into(),
        },
    )
    .await?;
    let holding_id = upsert_holding(
        &mut conn,
        account_id,
        instrument_id,
        &cash_holding("acct-1", Decimal::new(30000, 2)),
    )
    .await?;
    stamp_on(
        &pool,
        holding_id,
        chrono::Utc::now().date_naive(),
        Decimal::new(30000, 2),
        Decimal::new(30000, 2),
        Decimal::new(30000, 2),
    )
    .await;

    let rows = query::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(row.unexplained_quantity, Decimal::ZERO);
    Ok(())
}

/// The gap-detection subquery must be scoped to (account, instrument), not the
/// instrument alone: another user's buy of the same ETF must never reduce this
/// holding's unexplained figure (§9.1 cross-user scoping, mirroring the
/// backfill-engine bug found earlier in this feature).
#[sqlx::test(migrations = "../migrations")]
async fn another_users_buy_of_the_same_instrument_does_not_explain_this_holding(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_a = seed_connection(&pool).await;
    let user_a: Uuid = sqlx::query_scalar("select user_id from connection where id = $1")
        .bind(conn_a)
        .fetch_one(&pool)
        .await?;
    let conn_b = seed_connection(&pool).await;

    let mut conn = pool.acquire().await?;
    let account_a = upsert_account(&mut conn, conn_a, &checking_account("acct-a")).await?;
    let account_b = upsert_account(&mut conn, conn_b, &checking_account("acct-b")).await?;

    let h_a = equity_holding(
        "acct-a",
        "IE0004",
        Decimal::new(100, 0),
        Decimal::new(1000, 0),
        Some(Decimal::new(1200, 0)),
    );
    let instrument_id = resolve_instrument(&mut conn, &h_a.instrument).await?;
    let holding_a = upsert_holding(&mut conn, account_a, instrument_id, &h_a).await?;
    stamp_on(
        &pool,
        holding_a,
        chrono::Utc::now().date_naive(),
        h_a.quantity,
        Decimal::new(1200, 0),
        h_a.cost_basis,
    )
    .await;

    let h_b = equity_holding(
        "acct-b",
        "IE0004",
        Decimal::new(100, 0),
        Decimal::new(1000, 0),
        Some(Decimal::new(1200, 0)),
    );
    let holding_b = upsert_holding(&mut conn, account_b, instrument_id, &h_b).await?;
    stamp_on(
        &pool,
        holding_b,
        chrono::Utc::now().date_naive(),
        h_b.quantity,
        Decimal::new(1200, 0),
        h_b.cost_basis,
    )
    .await;

    // User B buys 100 of the same instrument in their own account — must not
    // explain user A's holding.
    sqlx::query(
        "insert into transaction (account_id, instrument_id, ts, type, quantity, unit_price, amount) \
         values ($1, $2, now(), 'buy', 100, 10, -1000)",
    )
    .bind(account_b)
    .bind(instrument_id)
    .execute(&pool)
    .await?;

    let rows = query::holdings(&pool, user_a).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_a)
        .expect("holding");
    assert_eq!(
        row.unexplained_quantity,
        Decimal::new(100, 0),
        "user A's holding must remain fully unexplained"
    );
    Ok(())
}
