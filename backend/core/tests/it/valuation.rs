use chrono::NaiveDate;
use gripsou_core::dto::SyncResult;
use gripsou_core::ingest::ingest;
use gripsou_core::repo::account::upsert_account;
use gripsou_core::repo::holding::upsert_holding;
use gripsou_core::repo::instrument::resolve_instrument;
use gripsou_core::repo::valuation;
use gripsou_core::testkit::{
    self, Lot, cash_holding, checking_account, equity_holding, holding_ids, insert_price_on,
    seed_connection, seed_equity_holding, stamp_on,
};
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

#[gripsou_core::testkit::db_test]
async fn net_worth_series_groups_by_day(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    // Pinned to the pivot so the numbers are plain valuation arithmetic.
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
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0)), equity],
            ..Default::default()
        },
    )
    .await?;

    let ids = holding_ids(&pool).await;
    let (d1, d2) = (
        NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
        NaiveDate::from_ymd_opt(2026, 1, 2).unwrap(),
    );
    stamp_on(&pool, ids[0], d1, Decimal::new(3, 0), Decimal::new(600, 0)).await;
    stamp_on(
        &pool,
        ids[1],
        d1,
        Decimal::new(100, 0),
        Decimal::new(100, 0),
    )
    .await;
    stamp_on(&pool, ids[0], d2, Decimal::new(3, 0), Decimal::new(630, 0)).await;
    stamp_on(
        &pool,
        ids[1],
        d2,
        Decimal::new(100, 0),
        Decimal::new(100, 0),
    )
    .await;

    let user_id = testkit::owner(&pool, conn_id).await;
    let rows = valuation::net_worth_series(&pool, user_id, d1, d2).await?;

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].as_of, d1);
    assert_eq!(rows[0].net_worth, Some(Decimal::new(700, 0)));
    assert_eq!(rows[0].invested, Some(Decimal::new(550, 0)));
    assert_eq!(rows[1].net_worth, Some(Decimal::new(730, 0)));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn net_worth_excludes_pre_acquisition_and_values_by_price(
    pool: PgPool,
) -> anyhow::Result<()> {
    // The equity is acquired only on d1: no phantom holding on d0, and d1 is valued from the price series, not snapshot.value.
    let conn_id = seed_connection(&pool).await;
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
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0)), equity],
            ..Default::default()
        },
    )
    .await?;

    let ids = holding_ids(&pool).await;
    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind <> 'cash'")
            .fetch_one(&pool)
            .await?;
    let d0 = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    let d1 = NaiveDate::from_ymd_opt(2026, 1, 2).unwrap();
    let at = |d: NaiveDate| d.and_hms_opt(12, 0, 0).unwrap().and_utc();

    stamp_on(
        &pool,
        ids[1],
        d0,
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
    )
    .await;
    stamp_on(&pool, ids[0], d1, Decimal::new(3, 0), Decimal::new(600, 0)).await;
    // 210 differs from snapshot.value (600): price-based is 3*210 = 630.
    insert_price_on(&pool, instrument_id, at(d0), Decimal::new(210, 0)).await;
    insert_price_on(&pool, instrument_id, at(d1), Decimal::new(210, 0)).await;

    let user_id = testkit::owner(&pool, conn_id).await;
    let rows = valuation::net_worth_series(&pool, user_id, d0, d1).await?;

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].as_of, d0);
    assert_eq!(
        rows[0].net_worth,
        Some(Decimal::new(100, 0)),
        "d0: cash only; equity not yet acquired must not appear"
    );
    assert_eq!(
        rows[0].invested,
        Some(Decimal::new(100, 0)),
        "d0: only cash cost basis"
    );
    assert_eq!(
        rows[1].net_worth,
        Some(Decimal::new(730, 0)),
        "d1: cash 100 + equity 3*210 (price-driven, not snapshot.value 600)"
    );
    assert_eq!(
        rows[1].invested,
        Some(Decimal::new(550, 0)),
        "d1: 100 + 450"
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn accounts_sum_latest_snapshot_per_account(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
            ..Default::default()
        },
    )
    .await?;
    let ids = holding_ids(&pool).await;
    let today = chrono::Utc::now().date_naive();
    let yesterday = today - chrono::Days::new(1);
    stamp_on(
        &pool,
        ids[0],
        yesterday,
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
    )
    .await;

    let user_id = testkit::owner(&pool, conn_id).await;
    let rows = valuation::accounts(&pool, user_id).await?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "Current account");
    assert_eq!(rows[0].type_key, "checking");
    assert_eq!(
        rows[0].value,
        Decimal::new(120, 0),
        "uses the latest snapshot, not the first"
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn holdings_join_latest_price_and_spark(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            ..Default::default()
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

    let user_id = testkit::owner(&pool, conn_id).await;
    let rows = valuation::holdings(&pool, user_id).await?;

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

#[gripsou_core::testkit::db_test]
async fn holdings_excludes_closed_zero_quantity(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
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
            ..Default::default()
        },
    )
    .await?;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            ..Default::default()
        },
    )
    .await?;

    let user_id = testkit::owner(&pool, conn_id).await;
    let rows = valuation::holdings(&pool, user_id).await?;
    assert_eq!(
        rows.len(),
        1,
        "closed (zero-quantity) holdings are excluded"
    );
    assert_eq!(rows[0].kind, "equity");
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn holding_prices_windowed_and_owned(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            ..Default::default()
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
    .await;
    insert_price_on(
        &pool,
        instrument_id,
        base - chrono::Duration::days(1),
        Decimal::new(200, 0),
    )
    .await;

    let user_id = testkit::owner(&pool, conn_id).await;
    let from = base - chrono::Duration::days(3);
    let prices = valuation::holding_prices(&pool, user_id, holding_id, from, base).await?;
    assert_eq!(prices.len(), 1);
    assert_eq!(prices[0].unit_price, Decimal::new(200, 0));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn holding_prices_converts_at_the_rate_of_the_day(pool: PgPool) -> anyhow::Result<()> {
    use gripsou_core::testkit::{insert_price, rate_on, seed_cash_instrument};
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                None,
            )],
            ..Default::default()
        },
    )
    .await?;
    let holding_id = holding_ids(&pool).await[0];
    let instrument_id: Uuid = sqlx::query_scalar("select id from instrument where kind <> 'cash'")
        .fetch_one(&pool)
        .await?;
    let user_id = testkit::owner(&pool, conn_id).await;
    let d = |n: u32| NaiveDate::from_ymd_opt(2026, 3, n).unwrap();
    let at = |n: u32, h: u32| d(n).and_hms_opt(h, 0, 0).unwrap().and_utc();

    let usd = seed_cash_instrument(&pool, "USD").await;
    rate_on(&pool, usd, d(5), Decimal::new(5, 1)).await;
    rate_on(&pool, usd, d(8), Decimal::new(7, 1)).await;
    let mut conn = pool.acquire().await?;
    insert_price(&mut conn, usd, at(8, 18), Decimal::new(8, 1), "EUR").await?;
    for day in [4, 5, 7, 8] {
        insert_price(
            &mut conn,
            instrument_id,
            at(day, 12),
            Decimal::new(10, 0),
            "USD",
        )
        .await?;
    }
    drop(conn);

    let prices = valuation::holding_prices(&pool, user_id, holding_id, at(1, 0), at(20, 0)).await?;
    let account: Vec<_> = prices.iter().map(|p| p.account_price).collect();
    assert_eq!(
        account,
        vec![
            None,
            Some(Decimal::new(5, 0)),
            Some(Decimal::new(5, 0)),
            Some(Decimal::new(8, 0)),
        ]
    );
    assert!(prices.iter().all(|p| p.reporting_price == p.account_price));

    // In USD the USD listing needs no rate; day 4 stays unknown since the quote leg has none.
    sqlx::query("update users set currency = 'USD' where id = $1")
        .bind(user_id)
        .execute(&pool)
        .await?;
    let prices = valuation::holding_prices(&pool, user_id, holding_id, at(1, 0), at(20, 0)).await?;
    let reporting: Vec<_> = prices.iter().map(|p| p.reporting_price).collect();
    assert_eq!(
        reporting,
        vec![
            None,
            Some(Decimal::new(10, 0)),
            Some(Decimal::new(10, 0)),
            Some(Decimal::new(10, 0)),
        ]
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn holding_prices_carry_the_position_of_the_day(pool: PgPool) -> anyhow::Result<()> {
    use gripsou_core::testkit::{rate_on, seed_cash_instrument, seed_lot};
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(6, 0),
                Decimal::new(600, 0),
                None,
            )],
            ..Default::default()
        },
    )
    .await?;
    let holding_id = holding_ids(&pool).await[0];
    let instrument_id: Uuid = sqlx::query_scalar("select id from instrument where kind <> 'cash'")
        .fetch_one(&pool)
        .await?;
    let user_id = testkit::owner(&pool, conn_id).await;
    let d = |n: u32| NaiveDate::from_ymd_opt(2026, 3, n).unwrap();
    let at = |n: u32| d(n).and_hms_opt(12, 0, 0).unwrap().and_utc();
    for day in [1, 3, 7] {
        insert_price_on(&pool, instrument_id, at(day), Decimal::new(150, 0)).await;
    }
    seed_lot(&pool, holding_id, Lot::buy(d(2), dec("10"), dec("100"))).await;
    seed_lot(&pool, holding_id, Lot::sell(d(6), dec("4"), dec("200"))).await;

    let prices = valuation::holding_prices(&pool, user_id, holding_id, at(1), at(20)).await?;
    let position: Vec<_> = prices.iter().map(|p| (p.qty, p.invested)).collect();
    assert_eq!(
        position,
        vec![
            (None, None),
            (Some(dec("10")), Some(dec("1000"))),
            (Some(dec("6")), Some(dec("600"))),
        ]
    );

    // In USD at 0.5 EUR per USD, the invested line doubles.
    let usd = seed_cash_instrument(&pool, "USD").await;
    rate_on(&pool, usd, d(1), Decimal::new(5, 1)).await;
    sqlx::query("update users set currency = 'USD' where id = $1")
        .bind(user_id)
        .execute(&pool)
        .await?;
    let prices = valuation::holding_prices(&pool, user_id, holding_id, at(1), at(20)).await?;
    assert_eq!(prices[2].reporting_invested, Some(dec("1200")));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn holding_prices_hold_a_lotless_position_flat(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(7, 0),
                Decimal::new(70, 0),
                None,
            )],
            ..Default::default()
        },
    )
    .await?;
    let holding_id = holding_ids(&pool).await[0];
    let instrument_id: Uuid = sqlx::query_scalar("select id from instrument where kind <> 'cash'")
        .fetch_one(&pool)
        .await?;
    let user_id = testkit::owner(&pool, conn_id).await;
    let at = |n: u32| {
        NaiveDate::from_ymd_opt(2026, 3, n)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap()
            .and_utc()
    };
    insert_price_on(&pool, instrument_id, at(1), Decimal::new(10, 0)).await;

    let prices = valuation::holding_prices(&pool, user_id, holding_id, at(1), at(20)).await?;
    assert_eq!(prices[0].qty, Some(dec("7")));
    assert_eq!(prices[0].invested, Some(dec("70")));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn accounts_lists_latest_value_and_type(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
            ..Default::default()
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
    )
    .await;

    let user_id = testkit::owner(&pool, conn_id).await;
    let rows = valuation::accounts(&pool, user_id).await?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "Current account");
    assert_eq!(rows[0].connection_id, conn_id);
    assert_eq!(rows[0].type_key, "checking");
    assert_eq!(rows[0].value, Decimal::new(150, 0));
    assert!(
        rows[0].last_sync_at.is_none(),
        "test connection never synced"
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn accounts_value_equity_by_price(pool: PgPool) -> anyhow::Result<()> {
    // The accounts grid values equity from the price series, not snapshot.value, so it sums to net worth.
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            ..Default::default()
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

    let user_id = testkit::owner(&pool, conn_id).await;

    let accts = valuation::accounts(&pool, user_id).await?;
    assert_eq!(accts.len(), 1);
    assert_eq!(
        accts[0].value,
        Decimal::new(630, 0),
        "accounts: equity valued by price (3*210), not snapshot.value 600"
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn account_series_groups_by_account_and_day(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1"), checking_account("acct-2")],
            holdings: vec![
                cash_holding("acct-1", Decimal::new(100, 0)),
                cash_holding("acct-2", Decimal::new(200, 0)),
            ],
            ..Default::default()
        },
    )
    .await?;

    let pairs: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "select h.id, a.external_id from holding h join account a on a.id = h.account_id",
    )
    .fetch_all(&pool)
    .await?;
    let day = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    for (hid, ext) in &pairs {
        let v = if ext == "acct-1" { 100 } else { 200 };
        stamp_on(&pool, *hid, day, Decimal::new(v, 0), Decimal::new(v, 0)).await;
    }

    let user_id = testkit::owner(&pool, conn_id).await;
    let rows = valuation::account_series(&pool, user_id, day, day).await?;

    assert_eq!(rows.len(), 2, "one row per (account, day)");
    let total: Decimal = rows.iter().filter_map(|r| r.value).sum();
    assert_eq!(total, Decimal::new(300, 0));
    let distinct: std::collections::HashSet<_> = rows.iter().map(|r| r.account_id).collect();
    assert_eq!(distinct.len(), 2, "grouped per account");
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn holdings_includes_composition_when_present(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity_holding(
                "acct-1",
                "US0378331005",
                Decimal::new(3, 0),
                Decimal::new(450, 0),
                Some(Decimal::new(600, 0)),
            )],
            ..Default::default()
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

    let user_id = testkit::owner(&pool, conn_id).await;
    let rows = valuation::holdings(&pool, user_id).await?;
    let etf = rows.iter().find(|r| r.kind == "etf").unwrap();
    let comp = etf.composition.as_ref().unwrap();
    assert_eq!(comp.countries[0].name, "USA");
    assert!((comp.countries[0].weight - 0.6).abs() < 1e-10);
    assert!(comp.sectors.is_empty());
    Ok(())
}

#[gripsou_core::testkit::db_test]
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
            accounts: vec![cny_account],
            holdings: vec![cny_cash],
            ..Default::default()
        },
    )
    .await?;

    let today = chrono::Utc::now().date_naive();

    let rows =
        valuation::net_worth_series(&pool, testkit::owner(&pool, conn_id).await, today, today)
            .await?;
    assert_eq!(
        rows[0].net_worth,
        Some(Decimal::ZERO),
        "no rate → not counted"
    );
    assert!(rows[0].fx_missing, "and the UI must be told");

    let cny_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'cash' and currency = 'CNY'")
            .fetch_one(&pool)
            .await?;
    insert_price_on(&pool, cny_id, chrono::Utc::now(), "0.12".parse()?).await;

    let rows =
        valuation::net_worth_series(&pool, testkit::owner(&pool, conn_id).await, today, today)
            .await?;
    assert_eq!(rows[0].net_worth, Some("120.00".parse()?));
    assert!(!rows[0].fx_missing);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn foreign_cash_without_a_rate_is_not_read_in_the_account_currency(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let mut usd_cash = cash_holding("acct-1", Decimal::new(1000, 0));
    usd_cash.instrument.currency = "USD".to_string();
    usd_cash.instrument.name = "Dollar".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![usd_cash],
            ..Default::default()
        },
    )
    .await?;
    let user_id = testkit::owner(&pool, conn_id).await;
    let today = chrono::Utc::now().date_naive();

    let accounts = valuation::accounts(&pool, user_id).await?;
    assert_eq!(accounts[0].value, Decimal::ZERO);
    assert!(accounts[0].fx_missing);

    let rows =
        valuation::net_worth_series(&pool, user_id, today - chrono::Duration::days(1), today)
            .await?;
    assert_eq!(rows.len(), 2, "yesterday is derived, today is the snapshot");
    for row in rows {
        assert_eq!(row.net_worth, Some(Decimal::ZERO), "{}", row.as_of);
        assert!(row.fx_missing, "{}", row.as_of);
    }
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn net_worth_divides_into_the_reporting_currency(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
            ..Default::default()
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
    sqlx::query("update users set currency = 'USD' where id = $1")
        .bind(user_id)
        .execute(&pool)
        .await?;

    let today = chrono::Utc::now().date_naive();
    let rows = valuation::net_worth_series(&pool, user_id, today, today).await?;
    assert_eq!(rows[0].net_worth, Some("125".parse()?));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn holdings_report_converted_value_and_native_price(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
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
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity],
            ..Default::default()
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
    gripsou_core::testkit::insert_price(&mut conn, usd, chrono::Utc::now(), "0.90".parse()?, "EUR")
        .await?;
    gripsou_core::testkit::insert_price(
        &mut conn,
        equity_id,
        chrono::Utc::now(),
        "200".parse()?,
        "USD",
    )
    .await?;

    let rows = valuation::holdings(&pool, user_id).await?;
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
    // cost_basis is in the account's currency (EUR), so it converts at 1: the USD rate would understate invested by about 14%.
    assert_eq!(h.invested, "1500".parse()?, "1500 is already EUR");
    assert_eq!(h.invested_native, "1500".parse()?);
    assert!(!h.fx_missing);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn holdings_flag_and_zero_an_unconvertible_position(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    // The account must be CNY too: snapshot values are in the account's currency, so CNY cash in a EUR account counts as valued in EUR.
    let mut cny_account = checking_account("acct-1");
    cny_account.currency = "CNY".to_string();
    let mut cny_cash = cash_holding("acct-1", Decimal::new(1000, 0));
    cny_cash.instrument.currency = "CNY".to_string();
    cny_cash.instrument.name = "Yuan".to_string();
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![cny_account],
            holdings: vec![cny_cash],
            ..Default::default()
        },
    )
    .await?;

    let rows = valuation::holdings(&pool, user_id).await?;
    let h = &rows[0];
    assert_eq!(h.value, Decimal::ZERO);
    assert!(h.fx_missing);
    assert_eq!(h.quantity, Decimal::new(1000, 0), "the position is intact");
    Ok(())
}

/// All three valuation paths (holdings, accounts, net_worth_series) must give the same sum. One equity has no price row, so only the provider-valuation fallback can value it: this proves `holdings()` shares it.
#[gripsou_core::testkit::db_test]
async fn all_valuation_paths_agree(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

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
            accounts: vec![checking_account("acct-1")],
            holdings: vec![
                cash_holding("acct-1", Decimal::new(100, 0)),
                cny_cash,
                equity,
                unpriced,
            ],
            ..Default::default()
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
    // Select by ISIN: only this equity may get a price, the other must stay unpriced to exercise the fallback.
    let equity_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where isin = 'US0378331005'")
            .fetch_one(&pool)
            .await?;
    let mut conn = pool.acquire().await?;
    gripsou_core::testkit::insert_price(&mut conn, usd, chrono::Utc::now(), "0.90".parse()?, "EUR")
        .await?;
    gripsou_core::testkit::insert_price(
        &mut conn,
        cny_id,
        chrono::Utc::now(),
        "0.12".parse()?,
        "EUR",
    )
    .await?;
    gripsou_core::testkit::insert_price(
        &mut conn,
        equity_id,
        chrono::Utc::now(),
        "200".parse()?,
        "USD",
    )
    .await?;
    drop(conn);

    // Priced holdings get snapshot value 0 so a path reading snapshot.value instead of the price shows up. The unpriced one gets 400, its only valuation.
    let today = chrono::Utc::now().date_naive();
    let rows: Vec<(uuid::Uuid, String, Decimal)> = sqlx::query_as(
        "select h.id, i.name, h.quantity
         from holding h join instrument i on i.id = h.instrument_id",
    )
    .fetch_all(&pool)
    .await?;
    for (holding_id, name, qty) in rows {
        let value = if name == "Unpriced SA" {
            Decimal::new(400, 0)
        } else {
            Decimal::ZERO
        };
        stamp_on(&pool, holding_id, today, qty, value).await;
    }

    let holdings_total: Decimal = valuation::holdings(&pool, user_id)
        .await?
        .iter()
        .map(|r| r.value)
        .sum();
    let accounts_total: Decimal = valuation::accounts(&pool, user_id)
        .await?
        .iter()
        .map(|r| r.value)
        .sum();
    let net_worth_rows = valuation::net_worth_series(&pool, user_id, today, today).await?;
    let net_worth_total = net_worth_rows[0].net_worth.unwrap();

    assert_eq!(holdings_total, accounts_total, "holdings vs accounts");
    assert_eq!(
        accounts_total, net_worth_total,
        "accounts vs net_worth_series"
    );
    // The unpriced 400 is in the account's currency (EUR), so it converts at 1, not at the USD rate (that would give 360).
    assert_eq!(
        net_worth_total,
        "2420.00".parse()?,
        "100 + 120 + 1800 + 400 (fallback converted from the account currency)"
    );
    let unpriced = valuation::holdings(&pool, user_id)
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

/// Zeroed and flagged. The flag keys on the failed price, not the instrument's quote currency: labelled EUR (rate exists) but priced in GBP (none).
#[gripsou_core::testkit::db_test]
async fn a_price_in_an_unrated_currency_is_zeroed_and_flagged(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
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
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity],
            ..Default::default()
        },
    )
    .await?;

    let equity_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'equity'")
            .fetch_one(&pool)
            .await?;
    let mut conn = pool.acquire().await?;
    gripsou_core::testkit::insert_price(
        &mut conn,
        equity_id,
        chrono::Utc::now(),
        "150".parse()?,
        "GBP",
    )
    .await?;
    drop(conn);

    let h = valuation::holdings(&pool, user_id)
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

/// GBP is reachable only through `price.currency`, so the cash-instrument backfill and the eligibility union must not key off `instrument.currency` alone.
#[gripsou_core::testkit::db_test]
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
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity],
            ..Default::default()
        },
    )
    .await?;
    let equity_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'equity'")
            .fetch_one(&pool)
            .await?;
    let mut conn = pool.acquire().await?;
    gripsou_core::testkit::insert_price(
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

    let eligible =
        gripsou_core::price_sync::price_eligible_instruments_for_connection(&pool, conn_id).await?;
    assert!(
        eligible
            .iter()
            .any(|r| r.kind == "cash" && r.currency == "GBP"),
        "and it is offered to the price-fetch pass"
    );
    Ok(())
}

/// A malformed currency must never become a global cash instrument (the unique index would hold both "USD" and "usd") nor reach a Yahoo URL.
#[gripsou_core::testkit::db_test]
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
            accounts: vec![checking_account("acct-1")],
            holdings: vec![equity],
            ..Default::default()
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

#[gripsou_core::testkit::db_test]
async fn net_worth_reads_derived_history(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

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
    )
    .await;
    sqlx::query(
        "insert into holding_backfill (holding_id, as_of, quantity, value) \
         values ($1, $2, 75, 75)",
    )
    .bind(holding_id)
    .bind(derived_day)
    .execute(&pool)
    .await?;

    let rows = valuation::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Some(Decimal::new(75, 0)),
        "derived quantity drives the point"
    );
    Ok(())
}

/// Returns (user_id, instrument_id). The derived day is `anchor - 1`: the backfill horizon ends one day past the earliest evidence, and days after the last snapshot have no anchor.
async fn seed_backfilled_equity(
    pool: &PgPool,
    anchor: NaiveDate,
    valuation: Decimal,
) -> anyhow::Result<(Uuid, Uuid)> {
    let conn_id = seed_connection(pool).await;
    let user_id = testkit::owner(pool, conn_id).await;

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
    stamp_on(pool, holding_id, anchor, Decimal::new(10, 0), valuation).await;

    testkit::backfill(pool, conn_id).await?;
    Ok((user_id, instrument_id))
}

/// A priceless security carries the anchor snapshot's unit valuation flat backward, or the chart dips to zero on derived days and raises fx_missing.
#[gripsou_core::testkit::db_test]
async fn a_priceless_security_keeps_its_valuation_on_derived_days(
    pool: PgPool,
) -> anyhow::Result<()> {
    let anchor = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    let derived_day = NaiveDate::from_ymd_opt(2026, 1, 9).unwrap();
    let (user_id, _) = seed_backfilled_equity(&pool, anchor, Decimal::new(1200, 0)).await?;

    let rows = valuation::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Some(Decimal::new(1200, 0)),
        "the anchor's unit valuation is carried flat backward, not zeroed"
    );
    assert!(
        !on_derived.fx_missing,
        "a valued derived day must not raise the missing-rate warning"
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_priced_security_is_valued_from_the_price_on_derived_days(
    pool: PgPool,
) -> anyhow::Result<()> {
    let anchor = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    let derived_day = NaiveDate::from_ymd_opt(2026, 1, 9).unwrap();
    // Provider valuation (1200) differs from the price (10 x 100) so only the primary branch passes.
    let (user_id, instrument_id) =
        seed_backfilled_equity(&pool, anchor, Decimal::new(1200, 0)).await?;
    insert_price_on(
        &pool,
        instrument_id,
        derived_day.and_hms_opt(12, 0, 0).unwrap().and_utc(),
        Decimal::new(100, 0),
    )
    .await;

    let rows = valuation::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Some(Decimal::new(1000, 0)),
        "the price wins over the carried valuation"
    );
    Ok(())
}

/// Returns (user_id, holding_id).
async fn seed_sold_equity(
    pool: &PgPool,
    held_day: Option<(NaiveDate, Decimal, Decimal)>,
    sell_day: NaiveDate,
    anchor: NaiveDate,
    cost_basis: Decimal,
) -> anyhow::Result<Uuid> {
    let conn_id = seed_connection(pool).await;
    let user_id = testkit::owner(pool, conn_id).await;

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
        stamp_on(pool, holding_id, day, qty, value).await;
    }
    // Securities move by `lot`, so the backfill's quantity walk needs the sell recorded there.
    testkit::seed_lot(
        pool,
        holding_id,
        Lot::sell(sell_day, Decimal::from(10), Decimal::from(120)),
    )
    .await;
    stamp_on(pool, holding_id, anchor, Decimal::ZERO, Decimal::ZERO).await;

    testkit::backfill(pool, conn_id).await?;
    Ok(user_id)
}

/// Every later snapshot has quantity zero, so the per-unit valuation is found looking backward. Otherwise the chart dips to zero while the position was held.
#[gripsou_core::testkit::db_test]
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

    let rows = valuation::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Some(Decimal::new(1200, 0)),
        "the last valued snapshot's unit value is carried forward into the held window"
    );
    assert!(
        !on_derived.fx_missing,
        "a valued derived day must not raise the missing-rate warning"
    );
    Ok(())
}

/// With no non-zero quantity anywhere, the derived value falls back to `holding.cost_basis` read flat: zero would undervalue an owned asset and raise fx_missing.
#[gripsou_core::testkit::db_test]
async fn a_priceless_security_with_no_valued_snapshot_falls_back_to_book_value(
    pool: PgPool,
) -> anyhow::Result<()> {
    // With no earlier snapshot the horizon starts a day before the sell: the only derived day still held.
    let derived_day = NaiveDate::from_ymd_opt(2026, 1, 6).unwrap();
    let sell_day = NaiveDate::from_ymd_opt(2026, 1, 7).unwrap();
    let anchor = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    let user_id = seed_sold_equity(&pool, None, sell_day, anchor, Decimal::new(1000, 0)).await?;

    let rows = valuation::net_worth_series(&pool, user_id, derived_day, anchor).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == derived_day)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Some(Decimal::new(1000, 0)),
        "with no market value available the row falls back to holding.cost_basis"
    );
    assert!(
        !on_derived.fx_missing,
        "a book-valued derived day must not raise the missing-rate warning"
    );
    Ok(())
}

/// A derived day between two snapshots reads the derived row, not the older snapshot.
#[gripsou_core::testkit::db_test]
async fn net_worth_prefers_the_derived_row_inside_a_gap(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

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
    )
    .await;
    stamp_on(
        &pool,
        holding_id,
        d10,
        Decimal::new(300, 0),
        Decimal::new(300, 0),
    )
    .await;
    sqlx::query(
        "insert into holding_backfill (holding_id, as_of, quantity, value) \
         values ($1, $2, 200, 200)",
    )
    .bind(holding_id)
    .bind(d5)
    .execute(&pool)
    .await?;

    let rows = valuation::net_worth_series(&pool, user_id, d1, d10).await?;
    let on_derived = rows
        .iter()
        .find(|r| r.as_of == d5)
        .expect("row for the derived day");
    assert_eq!(
        on_derived.net_worth,
        Some(Decimal::new(200, 0)),
        "the derived row wins over the older snapshot carried forward"
    );
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn reports_unexplained_quantity_per_holding(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

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
    )
    .await;

    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            chrono::Utc::now().date_naive(),
            Decimal::from(30),
            Decimal::from(10),
        ),
    )
    .await;

    let rows = valuation::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(row.unexplained_quantity, Decimal::new(70, 0));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn a_fully_explained_holding_reports_zero(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

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
    )
    .await;
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            chrono::Utc::now().date_naive(),
            Decimal::from(30),
            Decimal::from(10),
        ),
    )
    .await;

    let rows = valuation::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(row.unexplained_quantity, Decimal::ZERO);
    Ok(())
}

/// Over-explained reports a negative shortfall: a `greatest(…, 0)` floor would hide it and block the fix modal.
#[gripsou_core::testkit::db_test]
async fn an_over_explained_holding_reports_a_negative_gap(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

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
    )
    .await;
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            chrono::Utc::now().date_naive(),
            Decimal::from(50),
            Decimal::from(10),
        ),
    )
    .await;

    let rows = valuation::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(
        row.unexplained_quantity,
        Decimal::new(-20, 0),
        "over-explained must report the signed excess, not a floored zero"
    );
    Ok(())
}

/// Exercises the `sell` branch of the case expression.
#[gripsou_core::testkit::db_test]
async fn a_sell_increases_the_unexplained_quantity(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

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
    )
    .await;
    // Bought 80, sold 20: 100 − 80 + 20 = 40 unexplained.
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            chrono::Utc::now().date_naive(),
            Decimal::from(80),
            Decimal::from(10),
        ),
    )
    .await;
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::sell(
            chrono::Utc::now().date_naive(),
            Decimal::from(20),
            Decimal::from(10),
        ),
    )
    .await;

    let rows = valuation::holdings(&pool, user_id).await?;
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

#[gripsou_core::testkit::db_test]
async fn cash_is_never_unexplained(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

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
    )
    .await;

    let rows = valuation::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(row.unexplained_quantity, Decimal::ZERO);
    Ok(())
}

/// The gap subquery is scoped to (account, instrument): another user's buy of the same ETF must not reduce it.
#[gripsou_core::testkit::db_test]
async fn another_users_buy_of_the_same_instrument_does_not_explain_this_holding(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_a = seed_connection(&pool).await;
    let user_a = testkit::owner(&pool, conn_a).await;
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
    )
    .await;

    testkit::seed_lot(
        &pool,
        holding_b,
        Lot::buy(
            chrono::Utc::now().date_naive(),
            Decimal::from(100),
            Decimal::from(10),
        ),
    )
    .await;

    let rows = valuation::holdings(&pool, user_a).await?;
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

/// A join keyed on (instrument, day) or (currency, day) must not multiply rows, which would silently double net worth.
#[gripsou_core::testkit::db_test]
async fn sharing_an_instrument_or_currency_does_not_double_count(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    let mut conn = pool.acquire().await?;

    let a1 = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let a2 = upsert_account(&mut conn, conn_id, &checking_account("acct-2")).await?;
    let eur = resolve_instrument(
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
    let day = NaiveDate::from_ymd_opt(2026, 1, 10).unwrap();
    for (acct, ext, qty) in [(a1, "acct-1", "40"), (a2, "acct-2", "60")] {
        let q: Decimal = qty.parse().unwrap();
        let hid = upsert_holding(&mut conn, acct, eur, &cash_holding(ext, q)).await?;
        stamp_on(&pool, hid, day, q, q).await;
    }

    let rows = valuation::net_worth_series(&pool, user_id, day, day).await?;
    assert_eq!(rows.len(), 1, "one row per day, not one per holding");
    assert_eq!(
        rows[0].net_worth,
        Some(Decimal::new(100, 0)),
        "40 + 60, counted once each"
    );
    Ok(())
}

/// Once the user's lots explain the position exactly they beat the provider's `cost_basis`. Read-time only, so the next sync can't clobber it.
#[gripsou_core::testkit::db_test]
async fn complete_lots_override_the_providers_cost_basis(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    // The provider claims a basis of 999; the lots say 20 shares at μ = 25.
    let h = equity_holding(
        "acct-1",
        "IE0008",
        Decimal::new(20, 0),
        Decimal::new(999, 0),
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
    )
    .await;
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            chrono::Utc::now().date_naive(),
            Decimal::from(10),
            Decimal::from(20),
        ),
    )
    .await;
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            chrono::Utc::now().date_naive(),
            Decimal::from(10),
            Decimal::from(30),
        ),
    )
    .await;

    let rows = valuation::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(row.unexplained_quantity, Decimal::ZERO);
    assert_eq!(
        row.invested_native,
        Decimal::new(500, 0),
        "μ × quantity, not the provider's 999"
    );
    // Only the reporting-currency column passes through the fx conversion, so check it separately.
    assert_eq!(row.invested, Decimal::new(500, 0));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn partial_lots_leave_the_providers_cost_basis_alone(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;

    let mut conn = pool.acquire().await?;
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1")).await?;
    let h = equity_holding(
        "acct-1",
        "IE0009",
        Decimal::new(20, 0),
        Decimal::new(999, 0),
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
    )
    .await;
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            chrono::Utc::now().date_naive(),
            Decimal::from(10),
            Decimal::from(20),
        ),
    )
    .await;

    let rows = valuation::holdings(&pool, user_id).await?;
    let row = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("holding");
    assert_eq!(row.unexplained_quantity, Decimal::new(10, 0));
    assert_eq!(row.invested_native, Decimal::new(999, 0));
    assert_eq!(row.invested, Decimal::new(999, 0));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn holdings_invested_is_fee_inclusive(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;
    sqlx::query("update holding set cost_basis = 197.78 where id = $1")
        .bind(holding_id)
        .execute(&pool)
        .await
        .unwrap();
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            Decimal::from(2),
            dec("98.37"),
        )
        .fee(dec("1.05")),
    )
    .await;

    let rows = valuation::holdings(&pool, user_id).await.unwrap();
    let h = rows
        .iter()
        .find(|r| r.holding_id == holding_id)
        .expect("the seeded holding must be listed");
    assert_eq!(
        h.invested_native,
        dec("197.79"),
        "the 1,05 fee is part of the basis"
    );
    assert_eq!(h.mean_price, dec("98.895"));
}

#[gripsou_core::testkit::db_test]
async fn chart_invested_matches_the_holdings_table(pool: PgPool) {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    let mut conn = pool.acquire().await.unwrap();
    let account_id = upsert_account(&mut conn, conn_id, &checking_account("acct-1"))
        .await
        .unwrap();
    let holding_id = seed_equity_holding(&pool, account_id, "PUST", dec("2")).await;
    sqlx::query("update holding set cost_basis = 197.78 where id = $1")
        .bind(holding_id)
        .execute(&pool)
        .await
        .unwrap();
    testkit::seed_lot(
        &pool,
        holding_id,
        Lot::buy(
            NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            Decimal::from(2),
            dec("98.37"),
        )
        .fee(dec("1.05")),
    )
    .await;

    let instrument_id: Uuid = sqlx::query_scalar("select instrument_id from holding where id = $1")
        .bind(holding_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let today = chrono::Utc::now().date_naive();
    insert_price_on(
        &pool,
        instrument_id,
        today.and_hms_opt(12, 0, 0).unwrap().and_utc(),
        dec("110"),
    )
    .await;
    stamp_on(&pool, holding_id, today, dec("2"), dec("220")).await;

    // Another user's buy of the same instrument must not reach this user's `lb` array.
    let conn_b = seed_connection(&pool).await;
    let account_b = upsert_account(&mut conn, conn_b, &checking_account("acct-b"))
        .await
        .unwrap();
    let holding_b = seed_equity_holding(&pool, account_b, "PUST", dec("100")).await;
    sqlx::query("update holding set cost_basis = 99999 where id = $1")
        .bind(holding_b)
        .execute(&pool)
        .await
        .unwrap();
    testkit::seed_lot(
        &pool,
        holding_b,
        Lot::buy(
            NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            Decimal::from(100),
            Decimal::from(999),
        ),
    )
    .await;

    let series = valuation::net_worth_series(&pool, user_id, today, today)
        .await
        .unwrap();
    let table = valuation::holdings(&pool, user_id).await.unwrap();

    let chart_invested = series.last().unwrap().invested.unwrap();
    let table_invested: Decimal = table.iter().map(|h| h.invested).sum();
    assert_eq!(chart_invested, table_invested);
    assert_eq!(
        chart_invested,
        dec("197.79"),
        "the fee-inclusive lot basis, unaffected by user B's much larger buy of the same instrument"
    );
}

/// Cash cancels exactly every day: using today's balance on past days would put the invested line above net worth.
#[gripsou_core::testkit::db_test]
async fn cash_invested_follows_the_balance_held_that_day(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(120, 0))],
            ..Default::default()
        },
    )
    .await?;
    let ids = holding_ids(&pool).await;
    let today = chrono::Utc::now().date_naive();
    let yesterday = today - chrono::Days::new(1);
    stamp_on(&pool, ids[0], yesterday, dec("100"), dec("100")).await;
    stamp_on(&pool, ids[0], today, dec("120"), dec("120")).await;

    let user_id = testkit::owner(&pool, conn_id).await;
    let series = valuation::net_worth_series(&pool, user_id, yesterday, today).await?;

    assert_eq!(series.len(), 2);
    assert_eq!(
        series[0].invested,
        Some(dec("100")),
        "yesterday's balance, not today's"
    );
    assert_eq!(series[1].invested, Some(dec("120")));
    for p in &series {
        assert_eq!(
            p.invested, p.net_worth,
            "cash is valued at book on both sides: the gap must be exactly zero"
        );
    }
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn reporting_in_a_currency_with_no_rate_leaves_the_figure_out(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(100, 0))],
            ..Default::default()
        },
    )
    .await?;
    let today = chrono::Utc::now().date_naive();

    sqlx::query("update users set currency = 'USD' where id = $1")
        .bind(user_id)
        .execute(&pool)
        .await?;
    let rows = valuation::net_worth_series(&pool, user_id, today, today).await?;
    assert_eq!(
        rows[0].net_worth, None,
        "a gap in the chart, not 100 euros read as dollars"
    );
    assert_eq!(rows[0].invested, None);
    assert!(rows[0].fx_missing);
    let listed = gripsou_core::repo::connection::list_connection_accounts(&pool, user_id).await?;
    assert_eq!(
        listed[0].value, None,
        "the connections list says the rate is missing"
    );
    let series = valuation::account_series(&pool, user_id, today, today).await?;
    assert_eq!(series[0].value, None);
    let accounts = valuation::accounts(&pool, user_id).await?;
    assert_eq!(accounts[0].value, Decimal::ZERO);
    assert!(accounts[0].fx_missing);
    assert_eq!(accounts[0].value_native, Some(Decimal::new(100, 0)));
    let holdings = valuation::holdings(&pool, user_id).await?;
    assert_eq!(holdings[0].value, Decimal::ZERO);
    assert!(holdings[0].fx_missing);

    let usd: uuid::Uuid = sqlx::query_scalar(
        "insert into instrument (kind, name, currency) values ('cash', 'Dollar', 'USD') returning id",
    )
    .fetch_one(&pool)
    .await?;
    insert_price_on(&pool, usd, chrono::Utc::now(), "0.80".parse()?).await;
    let rows = valuation::net_worth_series(&pool, user_id, today, today).await?;
    assert_eq!(rows[0].net_worth, Some("125".parse()?));
    let listed = gripsou_core::repo::connection::list_connection_accounts(&pool, user_id).await?;
    assert_eq!(listed[0].value, Some("125".parse()?));
    Ok(())
}

/// A priceable position in an account with no rate: `invested` must flag the unconvertible basis, or the gain reads several hundred percent.
#[gripsou_core::testkit::db_test]
async fn invested_flags_a_basis_it_could_not_convert(pool: PgPool) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    let user_id = testkit::owner(&pool, conn_id).await;
    let mut cny_account = checking_account("acct-cny");
    cny_account.currency = "CNY".to_string();
    // Priced in the pivot, so VALUE resolves; only the account-currency rate is missing.
    let equity = equity_holding(
        "acct-cny",
        "US0378331005",
        Decimal::new(3, 0),
        Decimal::new(600, 0),
        Some(Decimal::new(1350, 0)),
    );
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![cny_account],
            holdings: vec![equity],
            ..Default::default()
        },
    )
    .await?;
    let instrument_id: uuid::Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'equity'")
            .fetch_one(&pool)
            .await?;
    insert_price_on(
        &pool,
        instrument_id,
        chrono::Utc::now(),
        Decimal::new(450, 0),
    )
    .await;
    let today = chrono::Utc::now().date_naive();

    let rows = valuation::net_worth_series(&pool, user_id, today, today).await?;
    assert_eq!(
        rows[0].net_worth,
        Some("1350".parse()?),
        "priced, so counted"
    );
    assert_eq!(
        rows[0].invested,
        Some(Decimal::ZERO),
        "no CNY rate to convert it"
    );
    assert!(
        rows[0].fx_missing,
        "the gap between the two lines is not a gain and must not read as one"
    );
    let accounts = valuation::accounts(&pool, user_id).await?;
    assert!(
        accounts[0].fx_missing,
        "the accounts card flags the same basis"
    );
    let held = valuation::holdings(&pool, user_id).await?;
    assert_eq!(held[0].invested, Decimal::ZERO);
    assert!(held[0].fx_missing, "the holdings row says so too");

    let cny: uuid::Uuid = sqlx::query_scalar(
        "insert into instrument (kind, name, currency) values ('cash', 'Yuan', 'CNY') returning id",
    )
    .fetch_one(&pool)
    .await?;
    insert_price_on(&pool, cny, chrono::Utc::now(), "0.12".parse()?).await;
    let rows = valuation::net_worth_series(&pool, user_id, today, today).await?;
    assert_eq!(rows[0].invested, Some("72.00".parse()?), "600 CNY at 0.12");
    assert!(!rows[0].fx_missing);
    Ok(())
}

async fn cny_account(pool: &PgPool) -> anyhow::Result<Uuid> {
    use gripsou_core::testkit::checking_account_in;
    let conn_id = seed_connection(pool).await;
    let mut cash = cash_holding("acct-cny", Decimal::new(800, 0));
    cash.instrument.currency = "CNY".into();
    cash.instrument.name = "CNY".into();
    ingest(
        pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account_in("acct-cny", "CNY")],
            holdings: vec![cash],
            ..Default::default()
        },
    )
    .await?;
    Ok(testkit::owner(pool, conn_id).await)
}

#[gripsou_core::testkit::db_test]
async fn accounts_carry_their_balance_in_their_own_currency(pool: PgPool) -> anyhow::Result<()> {
    use gripsou_core::testkit::rate_on;
    let user_id = cny_account(&pool).await?;
    let today = chrono::Utc::now().date_naive();
    let cny: Uuid =
        sqlx::query_scalar("select id from instrument where kind = 'cash' and currency = 'CNY'")
            .fetch_one(&pool)
            .await?;
    rate_on(&pool, cny, today, "0.125".parse()?).await;

    let rows = valuation::accounts(&pool, user_id).await?;
    assert_eq!(rows[0].currency, "CNY");
    assert_eq!(rows[0].value, Decimal::new(100, 0));
    assert_eq!(rows[0].value_native, Some(Decimal::new(800, 0)));
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn accounts_native_balance_is_null_without_a_rate(pool: PgPool) -> anyhow::Result<()> {
    let user_id = cny_account(&pool).await?;
    let rows = valuation::accounts(&pool, user_id).await?;
    assert_eq!(rows[0].currency, "CNY");
    assert_eq!(rows[0].value_native, None);
    Ok(())
}

#[gripsou_core::testkit::db_test]
async fn accounts_in_the_readers_currency_have_native_equal_value(
    pool: PgPool,
) -> anyhow::Result<()> {
    let conn_id = seed_connection(&pool).await;
    ingest(
        &pool,
        conn_id,
        &SyncResult {
            accounts: vec![checking_account("acct-1")],
            holdings: vec![cash_holding("acct-1", Decimal::new(150, 0))],
            ..Default::default()
        },
    )
    .await?;
    let user_id = testkit::owner(&pool, conn_id).await;
    let rows = valuation::accounts(&pool, user_id).await?;
    assert_eq!(rows[0].currency, "EUR");
    assert_eq!(rows[0].value_native, Some(rows[0].value));
    Ok(())
}
