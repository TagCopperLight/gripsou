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
    /// Human-readable label, provider-cleaned (card masks stripped). A column,
    /// not `provider_meta`: the list renders it and search matches it (§4).
    pub description: Option<String>,
    /// The raw provider transaction payload, kept for forensics only —
    /// nothing the app reads lives here (§4, §6.2).
    pub provider_meta: serde_json::Value,
}

/// A single point on an instrument's price series.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PricePoint {
    pub ts: DateTime<Utc>,
    pub unit_price: Decimal,
    pub currency: String,
}

/// The financial institution (bank/broker) a connection belongs to. One per
/// connection. `key` is the provider's raw identifier; `provider_key` on the
/// connection namespaces it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Institution {
    pub key: String,
    pub name: String,
}

/// What an `AccountProvider::sync` returns for one connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub institution: Institution,
    pub accounts: Vec<CanonicalAccount>,
    pub holdings: Vec<CanonicalHolding>,
    pub transactions: Vec<CanonicalTransaction>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composition_round_trips_with_numeric_weights() {
        let c = Composition {
            countries: vec![Allocation {
                name: "United States".into(),
                weight: 0.621,
            }],
            sectors: vec![Allocation {
                name: "Technology".into(),
                weight: 0.312,
            }],
        };
        let v = serde_json::to_value(&c).unwrap();
        // Weights must be JSON numbers, not strings (display ratios, not money).
        assert!(v["countries"][0]["weight"].is_number());
        let back: Composition = serde_json::from_value(v).unwrap();
        assert_eq!(back.countries[0].name, "United States");
        assert_eq!(back.sectors[0].weight, 0.312);
    }
}
