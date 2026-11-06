//! Seeders and fixtures shared by the tests of every crate, behind the
//! `test-util` feature. Seeding uses the runtime `query()` API (no offline
//! cache needed); the library code under test uses the checked macros.

use chrono::{DateTime, NaiveDate, Utc};

use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::crypto::EncryptionKey;
use crate::dto::{CanonicalAccount, CanonicalHolding, CanonicalTransaction, InstrumentRef};
use crate::error::CoreError;
use crate::repo::budget::assign::{TransactionPatch, WriteOutcome, patch_transaction};
use crate::repo::lot::{LotSide, LotSource};
use crate::repo::user::Role;

/// The key every test encrypts with: `"a"` 64 times.
pub fn encryption_key() -> EncryptionKey {
    EncryptionKey::parse(Some(&"a".repeat(64))).unwrap()
}

/// Insert a user with a unique email, the user role and a password hash that
/// matches nothing. Every other column keeps its default.
pub async fn seed_user(pool: &PgPool) -> Uuid {
    let id = Uuid::new_v4();
    seed_user_with_id(pool, id, &format!("u-{id}@test.local"), Role::User, "x").await
}

/// Same, with a chosen email.
pub async fn seed_user_email(pool: &PgPool, email: &str) -> Uuid {
    seed_user_as(pool, email, Role::User, "x").await
}

/// Insert a user with a chosen email, role and password hash.
pub async fn seed_user_as(pool: &PgPool, email: &str, role: Role, password_hash: &str) -> Uuid {
    seed_user_with_id(pool, Uuid::new_v4(), email, role, password_hash).await
}

async fn seed_user_with_id(
    pool: &PgPool,
    id: Uuid,
    email: &str,
    role: Role,
    password_hash: &str,
) -> Uuid {
    sqlx::query(
        "insert into users (id, email, name, password_hash, role) \
         values ($1, $2, 'Test', $3, $4)",
    )
    .bind(id)
    .bind(email)
    .bind(password_hash)
    .bind(role)
    .execute(pool)
    .await
    .unwrap();
    id
}

/// Insert a user + connection, returning the connection id.
pub async fn seed_connection(pool: &PgPool) -> Uuid {
    let (_user_id, conn_id) = seed_user_and_connection(pool).await;
    conn_id
}

/// Same, but hands back the owning user so a test can add a second connection
/// under it (the backfill horizon is user-wide). The user is in UTC, so a
/// test's "today" does not depend on the hour it runs at.
pub async fn seed_user_and_connection(pool: &PgPool) -> (Uuid, Uuid) {
    let user_id = seed_user(pool).await;
    sqlx::query("update users set time_zone = 'UTC' where id = $1")
        .bind(user_id)
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
        health: None,
        balance_as_of: None,
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

/// A transaction of a given type, spent today, with no description and no
/// separate booking day. Chain [`CanonicalTransaction::on`],
/// [`CanonicalTransaction::booked_on`] and [`CanonicalTransaction::described`]
/// for the rest.
pub fn txn(
    account_external_id: &str,
    external_id: &str,
    kind: &str,
    amount: Decimal,
) -> CanonicalTransaction {
    CanonicalTransaction {
        account_external_id: account_external_id.to_string(),
        external_id: external_id.to_string(),
        kind: kind.to_string(),
        spent_on: Utc::now().date_naive(),
        amount,
        description: None,
        provider_meta: serde_json::json!({}),
        booked_on: None,
    }
}

impl CanonicalTransaction {
    pub fn on(self, spent_on: NaiveDate) -> Self {
        Self { spent_on, ..self }
    }

    /// The day the balance moved, when it differs from the spend day: the real
    /// shape of most Powens rows.
    pub fn booked_on(self, day: NaiveDate) -> Self {
        Self {
            booked_on: Some(day),
            ..self
        }
    }

    pub fn described(self, description: &str) -> Self {
        Self {
            description: Some(description.to_string()),
            ..self
        }
    }
}

/// An account in a given currency. `checking_account` hardcodes EUR, and the
/// budget aggregates exist to convert across currencies.
pub fn checking_account_in(external_id: &str, currency: &str) -> CanonicalAccount {
    CanonicalAccount {
        currency: currency.to_string(),
        ..checking_account(external_id)
    }
}

/// Upsert one price point, in any currency.
pub async fn insert_price(
    conn: &mut sqlx::PgConnection,
    instrument_id: Uuid,
    ts: DateTime<Utc>,
    unit_price: Decimal,
    currency: &str,
) -> Result<(), CoreError> {
    crate::repo::price::insert_prices(conn, instrument_id, &[(ts, unit_price)], currency).await?;
    Ok(())
}

/// Insert one price point for an instrument.
pub async fn insert_price_on(
    pool: &PgPool,
    instrument_id: Uuid,
    ts: DateTime<Utc>,
    unit_price: Decimal,
) {
    let mut conn = pool.acquire().await.unwrap();
    insert_price(&mut conn, instrument_id, ts, unit_price, "EUR")
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
) {
    let mut conn = pool.acquire().await.unwrap();
    crate::repo::snapshot::stamp_snapshot(&mut conn, holding_id, day, qty, value)
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

/// Upsert one equity holding and hand back its id. Wraps the
/// resolve-instrument-then-upsert-holding dance every lot test needs.
///
/// `account_id` is the account's own id (an `upsert_account` return value),
/// not its external id — the caller must have upserted the account first.
pub async fn seed_equity_holding(
    pool: &PgPool,
    account_id: Uuid,
    symbol: &str,
    quantity: Decimal,
) -> Uuid {
    let mut conn = pool.acquire().await.unwrap();
    let holding = equity_holding("unused", symbol, quantity, Decimal::ZERO, None);
    let instrument_id = crate::repo::instrument::resolve_instrument(&mut conn, &holding.instrument)
        .await
        .unwrap();
    crate::repo::holding::upsert_holding(&mut conn, account_id, instrument_id, &holding)
        .await
        .unwrap()
}

/// A purchase or sale as a test records it: entered by hand, no fee.
#[derive(Debug, Clone, Copy)]
pub struct Lot {
    pub side: LotSide,
    pub on: NaiveDate,
    pub quantity: Decimal,
    pub unit_price: Decimal,
    pub fee: Decimal,
    pub source: LotSource,
}

impl Lot {
    pub fn buy(on: NaiveDate, quantity: Decimal, unit_price: Decimal) -> Self {
        Self {
            side: LotSide::Buy,
            on,
            quantity,
            unit_price,
            fee: Decimal::ZERO,
            source: LotSource::Manual,
        }
    }

    pub fn sell(on: NaiveDate, quantity: Decimal, unit_price: Decimal) -> Self {
        Self {
            side: LotSide::Sell,
            ..Self::buy(on, quantity, unit_price)
        }
    }

    pub fn fee(self, fee: Decimal) -> Self {
        Self { fee, ..self }
    }

    /// A lot the provider reported, which the user may not delete.
    pub fn from_provider(self) -> Self {
        Self {
            source: LotSource::Provider,
            ..self
        }
    }
}

/// Insert a lot on a holding, whoever owns it, and return its id.
pub async fn seed_lot(db: impl sqlx::PgExecutor<'_>, holding_id: Uuid, lot: Lot) -> Uuid {
    sqlx::query_scalar(
        "insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source) \
         values ($1, $2, $3, $4, $5, $6, $7) returning id",
    )
    .bind(holding_id)
    .bind(lot.side)
    .bind(lot.on)
    .bind(lot.quantity)
    .bind(lot.unit_price)
    .bind(lot.fee)
    .bind(lot.source)
    .fetch_one(db)
    .await
    .unwrap()
}

/// The user who owns a connection.
pub async fn owner(pool: &PgPool, connection_id: Uuid) -> Uuid {
    crate::repo::connection::user_id(pool, connection_id)
        .await
        .unwrap()
        .expect("the connection exists")
}

/// A synced connection holding one equity: three USD-quoted shares (bought
/// for 450, valued at 600 by the provider) in an EUR checking account.
/// Returns the connection id.
pub async fn seed_one_equity(pool: &PgPool) -> Uuid {
    let conn_id = seed_connection(pool).await;
    let sync = crate::dto::SyncResult {
        accounts: vec![checking_account("acct-1")],
        holdings: vec![equity_holding(
            "acct-1",
            "US0378331005",
            Decimal::new(3, 0),
            Decimal::new(450, 0),
            Some(Decimal::new(600, 0)),
        )],
        ..Default::default()
    };
    crate::ingest::ingest(pool, conn_id, &sync).await.unwrap();
    conn_id
}

/// The cash instrument of a currency.
pub async fn seed_cash_instrument(pool: &PgPool, currency: &str) -> Uuid {
    let mut conn = pool.acquire().await.unwrap();
    crate::repo::instrument::ensure_cash(&mut conn, currency)
        .await
        .unwrap()
        .id
}

/// One rate for one currency on one day.
pub async fn rate_on(pool: &PgPool, instrument_id: Uuid, d: NaiveDate, rate: Decimal) {
    let mut conn = pool.acquire().await.unwrap();
    insert_price(
        &mut conn,
        instrument_id,
        d.and_hms_opt(0, 0, 0).unwrap().and_utc(),
        rate,
        "EUR",
    )
    .await
    .unwrap();
}

/// File one of the user's rows under a category (or clear it) the way the
/// user does, pair breaks confirmed. Panics when the row or the category is
/// not the user's.
pub async fn set_category(pool: &PgPool, user_id: Uuid, txn_id: Uuid, category_id: Option<Uuid>) {
    patch(
        pool,
        user_id,
        txn_id,
        &TransactionPatch {
            category_id: Some(category_id),
            ..TransactionPatch::default()
        },
    )
    .await;
}

/// Replace one of the user's rows' tags the way the user does. Panics when
/// the row or a tag is not the user's.
pub async fn set_tags(pool: &PgPool, user_id: Uuid, txn_id: Uuid, tag_ids: &[Uuid]) {
    patch(
        pool,
        user_id,
        txn_id,
        &TransactionPatch {
            tag_ids: Some(tag_ids),
            ..TransactionPatch::default()
        },
    )
    .await;
}

async fn patch(pool: &PgPool, user_id: Uuid, txn_id: Uuid, patch: &TransactionPatch<'_>) {
    let outcome = patch_transaction(pool, user_id, txn_id, patch, true)
        .await
        .unwrap();
    assert_eq!(outcome, WriteOutcome::Done(()));
}

/// A price provider for currencies only: answers every rate with `rate`
/// stamped today, or fails every request when `rate` is `None` (Yahoo down).
pub struct FixedRateProvider {
    pub rate: Option<Decimal>,
}

#[async_trait::async_trait]
impl crate::provider::PriceProvider for FixedRateProvider {
    fn key(&self) -> &str {
        "fixed-rate"
    }
    fn supports(&self, instrument: &InstrumentRef) -> bool {
        instrument.kind == "cash"
    }
    async fn resolve_symbol(
        &self,
        instrument: &InstrumentRef,
    ) -> Result<Option<String>, crate::provider::ProviderError> {
        Ok(Some(format!("{}EUR=X", instrument.currency)))
    }
    async fn fetch_prices(
        &self,
        _symbol: &str,
        _since: Option<DateTime<Utc>>,
    ) -> Result<Vec<crate::dto::PricePoint>, crate::provider::ProviderError> {
        match self.rate {
            Some(rate) => Ok(vec![crate::dto::PricePoint {
                ts: Utc::now(),
                unit_price: rate,
                currency: "EUR".into(),
            }]),
            None => Err(crate::provider::ProviderError::Other(
                "rate unavailable".into(),
            )),
        }
    }
}
