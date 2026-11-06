use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// An account as understood by gripsou, independent of any provider.
#[derive(Debug, Clone)]
pub struct CanonicalAccount {
    pub external_id: String,
    pub name: String,
    /// Maps onto `account_type.key` (e.g. `checking`, `pea`).
    pub type_key: String,
    pub currency: String,
    /// Provider specifics, stored in `account.provider_meta`.
    pub meta: Value,
    /// What the provider reports of its last read at the bank. `None` when
    /// it reports nothing.
    pub health: Option<SyncHealth>,
    /// The day the provider last read this account at the bank, which is the
    /// day its holdings are true on. `None` means today. A provider that can't
    /// reach the bank keeps returning old balances: dating them today would
    /// save a false snapshot and hide the real history behind it.
    pub balance_as_of: Option<NaiveDate>,
}

/// Reference to an instrument; the core resolves/creates the global row.
#[derive(Debug, Clone)]
pub struct InstrumentRef {
    /// `cash` | `equity` | `etf`
    pub kind: String,
    pub symbol: Option<String>,
    pub isin: Option<String>,
    pub name: String,
    pub currency: String,
}

/// A current position reported by a provider.
#[derive(Debug, Clone)]
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
#[derive(Debug, Clone)]
pub struct CanonicalTransaction {
    /// `external_id` of the owning account (links to a `CanonicalAccount`).
    pub account_external_id: String,
    pub external_id: String,
    /// `deposit` | `withdrawal` | `buy` | `sell` | `dividend` | `fee` |
    /// `interest` | `transfer`
    pub kind: String,
    /// The day the user spent (Powens' `rdate`).
    pub spent_on: NaiveDate,
    /// Cash impact on the account.
    pub amount: Decimal,
    /// Human-readable label, provider-cleaned (card masks stripped). A column,
    /// not `provider_meta`: the list renders it and search matches it.
    pub description: Option<String>,
    /// The raw provider transaction payload, kept for forensics only —
    /// nothing the app reads lives here.
    pub provider_meta: serde_json::Value,
    /// The day the provider's balance actually moved, when it reports one
    /// separately from `spent_on`. They disagree on 70% of real rows by up to
    /// five days. The backfill walks on this, because it anchors on the
    /// balance; the UI shows `spent_on`.
    pub booked_on: Option<NaiveDate>,
}

/// A single point on an instrument's price series.
#[derive(Debug, Clone)]
pub struct PricePoint {
    pub ts: DateTime<Utc>,
    pub unit_price: Decimal,
    pub currency: String,
}

/// The financial institution (bank/broker) a connection belongs to. One per
/// connection. `key` is the provider's raw identifier; `provider_key` on the
/// connection namespaces it.
#[derive(Debug, Clone, Default)]
pub struct Institution {
    pub key: String,
    pub name: String,
}

/// Rows a provider returned but the adapter could not map, by kind.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SkippedCounts {
    pub accounts: usize,
    pub holdings: usize,
    pub transactions: usize,
}

/// How a provider last reached the bank, for one account or a whole
/// connection. Stored as `sync_health` in their `provider_meta`, in this
/// serde shape (rows already hold it). Provider calendar dates are labels,
/// not timezone-qualified instants.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncHealth {
    pub verified: bool,
    pub last_updated_on: Option<chrono::NaiveDate>,
    pub state: Option<String>,
    pub error_message: Option<String>,
    pub next_retry_on: Option<chrono::NaiveDate>,
}

impl SyncHealth {
    /// `meta` with `health` kept as its `sync_health` (null when unknown).
    pub fn into_meta(health: Option<&SyncHealth>, mut meta: Value) -> Value {
        if !meta.is_object() {
            meta = Value::Object(Default::default());
        }
        meta["sync_health"] = serde_json::to_value(health).unwrap_or(Value::Null);
        meta
    }

    /// The `sync_health` kept in a `provider_meta`. Absent, null or
    /// unreadable reads as unknown.
    pub fn from_meta(meta: &Value) -> Option<SyncHealth> {
        let stored = meta.get("sync_health").filter(|v| !v.is_null())?;
        match serde_json::from_value(stored.clone()) {
            Ok(h) => Some(h),
            Err(e) => {
                tracing::warn!(error = %e, "stored sync health unreadable");
                None
            }
        }
    }
}

/// What an `AccountProvider::sync` returns for one connection.
#[derive(Debug, Clone, Default)]
pub struct SyncResult {
    /// The connection's health as a whole. `None` when the provider can't
    /// tell (it is then stored as unknown).
    pub health: Option<SyncHealth>,
    pub institution: Institution,
    pub accounts: Vec<CanonicalAccount>,
    pub holdings: Vec<CanonicalHolding>,
    pub transactions: Vec<CanonicalTransaction>,
    /// What the adapter dropped while mapping (logged, never ingested).
    pub skipped: SkippedCounts,
}

/// One slice of an ETF allocation breakdown. `weight` is a display ratio in
/// 0..1 (not money), so it is an f64 and serializes as a JSON number.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Allocation {
    pub name: String,
    pub weight: f64,
}

/// An ETF's country and sector breakdowns, as scraped from a composition source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Composition {
    pub countries: Vec<Allocation>,
    pub sectors: Vec<Allocation>,
}
