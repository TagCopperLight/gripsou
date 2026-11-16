use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct CanonicalAccount {
    pub external_id: String,
    pub name: String,
    /// Maps onto `account_type.key`.
    pub type_key: String,
    pub currency: String,
    pub meta: Value,
    pub health: Option<SyncHealth>,
    /// The day its holdings are true on; `None` means today. Dating stale balances today would save a false snapshot.
    pub balance_as_of: Option<NaiveDate>,
}

#[derive(Debug, Clone)]
pub struct InstrumentRef {
    /// `cash` | `equity` | `etf`
    pub kind: String,
    pub symbol: Option<String>,
    pub isin: Option<String>,
    pub name: String,
    pub currency: String,
}

#[derive(Debug, Clone)]
pub struct CanonicalHolding {
    pub account_external_id: String,
    pub instrument: InstrumentRef,
    pub quantity: Decimal,
    /// Lots that explain the position take precedence (`lot_basis`).
    pub cost_basis: Decimal,
    pub valuation: Option<Decimal>,
}

#[derive(Debug, Clone)]
pub struct CanonicalTransaction {
    pub account_external_id: String,
    pub external_id: String,
    /// `deposit` | `withdrawal` | `buy` | `sell` | `dividend` | `fee` |
    /// `interest` | `transfer`
    pub kind: String,
    /// The day the user spent (Powens' `rdate`).
    pub spent_on: NaiveDate,
    pub amount: Decimal,
    /// A column, not `provider_meta`: the list renders it and search matches it.
    pub description: Option<String>,
    /// Kept for forensics only; nothing the app reads lives here.
    pub provider_meta: serde_json::Value,
    /// The day the provider's balance moved, when it reports one separately from `spent_on` (they differ on
    /// most real rows by up to five days). The backfill walks on this because it anchors on the balance;
    /// the UI shows `spent_on`.
    pub booked_on: Option<NaiveDate>,
}

#[derive(Debug, Clone)]
pub struct PricePoint {
    pub ts: DateTime<Utc>,
    pub unit_price: Decimal,
    pub currency: String,
}

/// `key` is the provider's raw identifier; `provider_key` on the connection namespaces it.
#[derive(Debug, Clone, Default)]
pub struct Institution {
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SkippedCounts {
    pub accounts: usize,
    pub holdings: usize,
    pub transactions: usize,
}

/// Stored as `sync_health` in `provider_meta`, in this serde shape. Provider calendar dates are labels, not
/// instants.
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
    pub fn into_meta(health: Option<&SyncHealth>, mut meta: Value) -> Value {
        if !meta.is_object() {
            meta = Value::Object(Default::default());
        }
        meta["sync_health"] = serde_json::to_value(health).unwrap_or(Value::Null);
        meta
    }

    /// Absent, null or unreadable reads as unknown.
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

#[derive(Debug, Clone, Default)]
pub struct SyncResult {
    /// `None` when the provider can't tell (stored as unknown).
    pub health: Option<SyncHealth>,
    pub institution: Institution,
    pub accounts: Vec<CanonicalAccount>,
    pub holdings: Vec<CanonicalHolding>,
    pub transactions: Vec<CanonicalTransaction>,
    pub skipped: SkippedCounts,
}

/// `weight` is a display ratio in 0..1, not money, so an f64.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ts_rs::TS)]
pub struct Allocation {
    pub name: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default, ts_rs::TS)]
pub struct Composition {
    pub countries: Vec<Allocation>,
    pub sectors: Vec<Allocation>,
}
