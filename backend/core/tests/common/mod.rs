#![allow(dead_code)]
//! Shared test helpers. Seeding uses the runtime `query()` API (no offline
//! cache needed); the library code under test uses the checked macros.

use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use gripsou_core::dto::{
    CanonicalAccount, CanonicalHolding, CanonicalTransaction, InstrumentRef,
};

/// Insert a user + connection, returning the connection id.
pub async fn seed_connection(pool: &PgPool) -> Uuid {
    let user_id = Uuid::new_v4();
    sqlx::query(
        "insert into users (id, email, name, password_hash) values ($1, $2, 'Test', 'x')",
    )
    .bind(user_id)
    .bind(format!("u-{user_id}@test.local"))
    .execute(pool)
    .await
    .unwrap();

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

pub fn deposit_txn(account_external_id: &str, external_id: &str, amount: Decimal) -> CanonicalTransaction {
    CanonicalTransaction {
        account_external_id: account_external_id.to_string(),
        external_id: external_id.to_string(),
        kind: "deposit".to_string(),
        ts: chrono::Utc::now(),
        quantity: None,
        unit_price: None,
        amount,
        fee: None,
    }
}
