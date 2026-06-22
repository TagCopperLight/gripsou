mod common;

use chrono::NaiveDate;
use common::{
    cash_holding, checking_account, equity_holding, holding_ids, insert_price_on, seed_connection,
    stamp_on,
};
use gripsou_core::dto::{Institution, SyncResult};
use gripsou_core::ingest::ingest;
use gripsou_core::repo::query;
use rust_decimal::Decimal;
use sqlx::PgPool;

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
    assert_eq!(rows[0].category_key, "cash");
    assert_eq!(rows[0].category_label, "Cash");
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
async fn account_types_returns_seeded_reference(pool: PgPool) -> anyhow::Result<()> {
    let types = query::account_types(&pool).await?;
    let keys: Vec<&str> = types.iter().map(|t| t.key.as_str()).collect();
    assert!(keys.contains(&"checking"));
    assert!(keys.contains(&"brokerage"));
    assert_eq!(
        types.len(),
        5,
        "five types seeded in 0002_seed_reference.sql"
    );
    Ok(())
}
