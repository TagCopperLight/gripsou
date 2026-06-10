use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// An account as understood by gripsou, independent of any provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalAccount {
    pub external_id: String,
    pub name: String,
    /// Maps onto `account_type.key` (e.g. `checking`, `pea`).
    pub type_key: String,
    pub currency: String,
    pub meta: Value,
}

/// Reference to an instrument; the core resolves/creates the global row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstrumentRef {
    /// `cash` | `equity` | `etf` | `crypto` | …
    pub kind: String,
    pub symbol: Option<String>,
    pub isin: Option<String>,
    pub name: String,
    pub currency: String,
}

/// A current position reported by a provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalHolding {
    /// `external_id` of the owning account (links to a `CanonicalAccount`).
    pub account_external_id: String,
    pub instrument: InstrumentRef,
    pub quantity: Decimal,
    /// Total invested. When a provider only gives aggregate cost basis, this
    /// carries it and the purchases-staircase degrades to a single step.
    pub cost_basis: Decimal,
    /// Provider-supplied valuation, if any (else valued from prices).
    pub valuation: Option<Decimal>,
}

/// A statement line or investment buy/sell.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalTransaction {
    /// `external_id` of the owning account (links to a `CanonicalAccount`).
    pub account_external_id: String,
    pub external_id: String,
    /// `deposit` | `withdrawal` | `buy` | `sell` | `dividend` | `fee` |
    /// `interest` | `transfer`
    pub kind: String,
    pub ts: DateTime<Utc>,
    pub quantity: Option<Decimal>,
    pub unit_price: Option<Decimal>,
    /// Cash impact on the account.
    pub amount: Decimal,
    pub fee: Option<Decimal>,
}

/// A single point on an instrument's price series.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PricePoint {
    pub ts: DateTime<Utc>,
    pub unit_price: Decimal,
    pub currency: String,
}

/// What an `AccountProvider::sync` returns for one connection.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncResult {
    pub accounts: Vec<CanonicalAccount>,
    pub holdings: Vec<CanonicalHolding>,
    pub transactions: Vec<CanonicalTransaction>,
}
