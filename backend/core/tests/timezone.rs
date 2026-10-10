mod common;

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;

#[sqlx::test(migrations = "../migrations")]
async fn today_uses_each_users_zone_and_dst(pool: PgPool) -> anyhow::Result<()> {
    let (user, _) = common::seed_user_and_connection(&pool).await;
    for (zone, instant, expected) in [
        (None, "2026-03-31T22:30:00Z", "2026-04-01"),
        (Some("Europe/Paris"), "2026-01-31T22:30:00Z", "2026-01-31"),
        (Some("Europe/Paris"), "2026-07-31T22:30:00Z", "2026-08-01"),
        (
            Some("America/Los_Angeles"),
            "2026-01-01T01:00:00Z",
            "2025-12-31",
        ),
        (
            Some("Pacific/Kiritimati"),
            "2026-12-31T12:00:00Z",
            "2027-01-01",
        ),
    ] {
        sqlx::query("update users set prefs = $2 where id = $1")
            .bind(user)
            .bind(zone.map_or(
                serde_json::json!({}),
                |z| serde_json::json!({"timeZone": z}),
            ))
            .execute(&pool)
            .await?;
        let now: DateTime<Utc> = instant.parse()?;
        let day: NaiveDate = sqlx::query_scalar("select user_today($1, $2)")
            .bind(user)
            .bind(now)
            .fetch_one(&pool)
            .await?;
        assert_eq!(day.to_string(), expected);
    }
    Ok(())
}

#[sqlx::test(migrations = "../migrations")]
async fn ingest_backfill_and_valuation_use_the_owners_day(pool: PgPool) -> anyhow::Result<()> {
    use gripsou_core::{
        dto::{Institution, SyncResult},
        ingest::ingest,
        repo::{prefs, query},
    };
    use rust_decimal::Decimal;
    let (user, connection) = common::seed_user_and_connection(&pool).await;
    // At every UTC hour at least one of these zones has a different day.
    // Select it in SQL so this regression runs at any time of day.
    let zone: String = sqlx::query_scalar(
        "select zone from unnest(array['Pacific/Kiritimati', 'Etc/GMT+12']) zone \
         where (now() at time zone zone)::date <> (now() at time zone 'UTC')::date limit 1",
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query("update users set prefs = jsonb_build_object('timeZone', $2::text) where id = $1")
        .bind(user)
        .bind(zone)
        .execute(&pool)
        .await?;
    let today = prefs::today(&pool, user).await?;
    let mut security = common::equity_holding(
        "a",
        "US0378331005",
        Decimal::ONE,
        Decimal::TEN,
        Some(Decimal::TEN),
    );
    security.instrument.currency = "EUR".into();
    ingest(
        &pool,
        connection,
        &SyncResult {
            provider_meta: Default::default(),
            skipped: Default::default(),
            institution: Institution::default(),
            accounts: vec![common::checking_account("a")],
            holdings: vec![security],
            transactions: vec![],
        },
    )
    .await?;
    let snapshot: NaiveDate = sqlx::query_scalar("select as_of from holding_snapshot")
        .fetch_one(&pool)
        .await?;
    assert_eq!(snapshot, today);
    let backfill: NaiveDate = sqlx::query_scalar("select max(as_of) from holding_backfill")
        .fetch_one(&pool)
        .await?;
    assert_eq!(backfill, today - chrono::Duration::days(1));
    sqlx::query(
        "insert into price (instrument_id, ts, unit_price, currency) \
         select instrument_id, ($1::date + day_offset)::timestamp at time zone 'UTC', value, 'EUR' \
         from holding cross join (values (0, 10), (1, 20)) p(day_offset, value)",
    )
    .bind(today)
    .execute(&pool)
    .await?;
    let holding_id = sqlx::query_scalar("select id from holding")
        .fetch_one(&pool)
        .await?;
    let preview_rows: Vec<_> = [today, today + chrono::Duration::days(1)]
        .into_iter()
        .map(|day| gripsou_core::repo::lot::PreviewLot {
            side: "buy".into(),
            acquired_on: day,
            quantity: Decimal::ONE,
            unit_price: Decimal::TEN,
            fee: Decimal::ZERO,
        })
        .collect();
    let preview = gripsou_core::repo::lot::basis_preview(&pool, user, holding_id, &preview_rows)
        .await?
        .unwrap();
    assert_eq!(preview.explained_qty, Decimal::ONE);
    assert_eq!(
        query::distribution(&pool, user).await?[0].value,
        Decimal::TEN
    );
    let holdings = query::holdings(&pool, user).await?;
    assert_eq!(holdings[0].price, Some(Decimal::TEN));
    assert_eq!(holdings[0].value, Decimal::TEN);
    assert_eq!(query::accounts(&pool, user).await?[0].value, Decimal::TEN);
    assert_eq!(
        query::net_worth_series(&pool, user, today, today).await?[0].net_worth,
        Decimal::TEN
    );
    Ok(())
}
