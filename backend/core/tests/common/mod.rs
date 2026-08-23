#![allow(dead_code)]
//! Shared test helpers. Seeding uses the runtime `query()` API (no offline
//! cache needed); the library code under test uses the checked macros.

use chrono::{DateTime, NaiveDate, Utc};

use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, CanonicalTransaction, InstrumentRef};

/// Insert a user + connection, returning the connection id.
pub async fn seed_connection(pool: &PgPool) -> Uuid {
    let (_user_id, conn_id) = seed_user_and_connection(pool).await;
    conn_id
}

/// Same, but hands back the owning user so a test can add a second connection
/// under it (the backfill horizon is user-wide).
pub async fn seed_user_and_connection(pool: &PgPool) -> (Uuid, Uuid) {
    let user_id = Uuid::new_v4();
    sqlx::query("insert into users (id, email, name, password_hash) values ($1, $2, 'Test', 'x')")
        .bind(user_id)
        .bind(format!("u-{user_id}@test.local"))
        .execute(pool)
        .await
        .unwrap();
    let conn_id = seed_connection_for(pool, user_id).await;
    (user_id, conn_id)
}

/// Insert another connection belonging to an existing user.
pub async fn seed_connection_for(pool: &PgPool, user_id: Uuid) -> Uuid {
    let conn_id = Uuid::new_v4();
    sqlx::query(
        "insert into connection (id, user_id, provider_key, display_name) \
         values ($1, $2, 'powens', 'Test connection')",
    )
    .bind(conn_id)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();

    conn_id
}

pub fn checking_account(external_id: &str) -> CanonicalAccount {
    CanonicalAccount {
        external_id: external_id.to_string(),
        name: "Current account".to_string(),
        type_key: "checking".to_string(),
        currency: "EUR".to_string(),
        meta: serde_json::json!({}),
    }
}

pub fn cash_holding(account_external_id: &str, quantity: Decimal) -> CanonicalHolding {
    CanonicalHolding {
        account_external_id: account_external_id.to_string(),
        instrument: InstrumentRef {
            kind: "cash".to_string(),
            symbol: None,
            isin: None,
            name: "Euro".to_string(),
            currency: "EUR".to_string(),
        },
        quantity,
        cost_basis: quantity,
        valuation: None,
    }
}

pub fn equity_holding(
    account_external_id: &str,
    isin: &str,
    quantity: Decimal,
    cost_basis: Decimal,
    valuation: Option<Decimal>,
) -> CanonicalHolding {
    CanonicalHolding {
        account_external_id: account_external_id.to_string(),
        instrument: InstrumentRef {
            kind: "equity".to_string(),
            symbol: Some("AAPL".to_string()),
            isin: Some(isin.to_string()),
            name: "Apple Inc.".to_string(),
            currency: "USD".to_string(),
        },
        quantity,
        cost_basis,
        valuation,
    }
}

pub fn deposit_txn(
    account_external_id: &str,
    external_id: &str,
    amount: Decimal,
) -> CanonicalTransaction {
    CanonicalTransaction {
        account_external_id: account_external_id.to_string(),
        external_id: external_id.to_string(),
        kind: "deposit".to_string(),
        ts: Utc::now(),
        quantity: None,
        unit_price: None,
        amount,
        fee: None,
        description: None,
        provider_meta: serde_json::json!({}),
    }
}

/// A transaction of an arbitrary type, for ingest/backfill tests.
pub fn txn(
    account_external_id: &str,
    external_id: &str,
    kind: &str,
    amount: Decimal,
    description: Option<&str>,
) -> CanonicalTransaction {
    CanonicalTransaction {
        account_external_id: account_external_id.to_string(),
        external_id: external_id.to_string(),
        kind: kind.to_string(),
        ts: Utc::now(),
        quantity: None,
        unit_price: None,
        amount,
        fee: None,
        description: description.map(str::to_string),
        provider_meta: serde_json::json!({}),
    }
}

/// Same, on a specific day (the backfill walks by date, not by instant).
pub fn txn_on(
    account_external_id: &str,
    external_id: &str,
    kind: &str,
    amount: Decimal,
    day: NaiveDate,
) -> CanonicalTransaction {
    CanonicalTransaction {
        ts: day.and_hms_opt(12, 0, 0).unwrap().and_utc(),
        ..txn(account_external_id, external_id, kind, amount, None)
    }
}

/// Insert one price point for an instrument.
pub async fn insert_price_on(
    pool: &PgPool,
    instrument_id: Uuid,
    ts: DateTime<Utc>,
    unit_price: Decimal,
) {
    let mut conn = pool.acquire().await.unwrap();
    gripsou_core::repo::price::insert_price(&mut conn, instrument_id, ts, unit_price, "EUR")
        .await
        .unwrap();
}

/// Stamp a snapshot for a holding on a specific day.
pub async fn stamp_on(
    pool: &PgPool,
    holding_id: Uuid,
    day: NaiveDate,
    qty: Decimal,
    value: Decimal,
    cost: Decimal,
) {
    let mut conn = pool.acquire().await.unwrap();
    gripsou_core::repo::snapshot::stamp_snapshot(&mut conn, holding_id, day, qty, value, cost)
        .await
        .unwrap();
}

/// Fetch holding ids, in instrument-name order.
pub async fn holding_ids(pool: &PgPool) -> Vec<Uuid> {
    sqlx::query_scalar(
        "select h.id from holding h join instrument i on i.id = h.instrument_id order by i.name",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}
