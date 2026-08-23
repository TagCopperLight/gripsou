//! Powens API wire models — only the fields the mapper consumes. Everything is
//! resilient (Option / serde defaults) so unexpected or missing fields never
//! break a sync. Decimals arrive as JSON numbers and are parsed exactly via
//! rust_decimal's arbitrary-precision serde adapter (no float step).

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Currency {
    /// ISO 4217 code, e.g. "EUR".
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BankAccount {
    pub id: i64,
    #[serde(default)]
    pub original_name: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, with = "rust_decimal::serde::arbitrary_precision_option")]
    pub balance: Option<Decimal>,
    #[serde(default)]
    pub currency: Option<Currency>,
    #[serde(rename = "type", default)]
    pub r#type: Option<String>,
    /// DateTime string or null; presence means the account is gone.
    #[serde(default)]
    pub deleted: Option<String>,
    #[serde(default)]
    pub iban: Option<String>,
    #[serde(default)]
    pub number: Option<String>,
    #[serde(default)]
    pub id_connection: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Investment {
    pub id: i64,
    pub id_account: i64,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
    /// "ISIN" or "AMF".
    #[serde(default)]
    pub code_type: Option<String>,
    #[serde(default)]
    pub stock_symbol: Option<String>,
    #[serde(default, with = "rust_decimal::serde::arbitrary_precision_option")]
    pub quantity: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::arbitrary_precision_option")]
    pub unitprice: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::arbitrary_precision_option")]
    pub valuation: Option<Decimal>,
    #[serde(default)]
    pub original_currency: Option<Currency>,
    #[serde(default)]
    pub deleted: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AccountsResponse {
    pub accounts: Vec<BankAccount>,
}

#[derive(Debug, Deserialize)]
pub struct InvestmentsResponse {
    pub investments: Vec<Investment>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Connector {
    #[serde(default)]
    pub uuid: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Connection {
    pub id: i64,
    /// Present when the request used `?expand=connector`.
    #[serde(default)]
    pub connector: Option<Connector>,
}

#[derive(Debug, Deserialize)]
pub struct ConnectionsResponse {
    pub connections: Vec<Connection>,
}

/// Minimal shape of a Powens webhook body — only what we need to correlate.
#[derive(Debug, Deserialize)]
pub struct WebhookConnection {
    pub id: i64,
}

#[derive(Debug, Deserialize)]
pub struct WebhookEnvelope {
    #[serde(default)]
    pub connection: Option<WebhookConnection>,
}

/// A Powens statement line. Only the fields gripsou actually reads: the
/// payload carries ~30 more that measured ~0% filled (TRANSACTIONS.md §2.1).
///
/// Deserializes via `TryFrom<serde_json::Value>` rather than a plain derive so
/// `raw` can keep the *entire* payload verbatim — `#[serde(flatten)]` would
/// only catch fields not already named on this struct (i.e. it would drop
/// `id_account`, `type`, ...), which defeats `provider_meta`'s forensic
/// purpose (§6.2, §4).
#[derive(Debug, Clone, Deserialize)]
#[serde(try_from = "serde_json::Value")]
pub struct PowensTransaction {
    pub id: i64,
    pub id_account: i64,
    /// Bank-side value date. 100% filled; preferred over `date`.
    pub rdate: Option<NaiveDate>,
    pub date: Option<NaiveDate>,
    /// Signed cash impact on the account.
    pub value: Option<Decimal>,
    pub wording: Option<String>,
    pub r#type: Option<String>,
    /// Not yet posted. Excluded from ingest — see §6.1.
    pub coming: bool,
    pub deleted: Option<String>,
    /// The raw JSON object Powens sent for this row, kept verbatim for
    /// `provider_meta` (§6.2, §4).
    pub raw: serde_json::Map<String, serde_json::Value>,
}

impl TryFrom<serde_json::Value> for PowensTransaction {
    type Error = serde_json::Error;

    fn try_from(value: serde_json::Value) -> Result<Self, Self::Error> {
        #[derive(Deserialize)]
        struct Typed {
            id: i64,
            id_account: i64,
            rdate: Option<NaiveDate>,
            date: Option<NaiveDate>,
            #[serde(default, with = "rust_decimal::serde::arbitrary_precision_option")]
            value: Option<Decimal>,
            wording: Option<String>,
            r#type: Option<String>,
            #[serde(default)]
            coming: bool,
            deleted: Option<String>,
        }

        let raw = value.as_object().cloned().unwrap_or_default();
        let typed: Typed = serde_json::from_value(value)?;
        Ok(PowensTransaction {
            id: typed.id,
            id_account: typed.id_account,
            rdate: typed.rdate,
            date: typed.date,
            value: typed.value,
            wording: typed.wording,
            r#type: typed.r#type,
            coming: typed.coming,
            deleted: typed.deleted,
            raw,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct LinkHref {
    pub href: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Links {
    pub next: Option<LinkHref>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TransactionsResponse {
    pub transactions: Vec<PowensTransaction>,
    #[serde(default, rename = "_links")]
    pub links: Links,
}
