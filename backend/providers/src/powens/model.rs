//! Powens API wire models — only the fields the mapper consumes. Everything is
//! resilient (Option / serde defaults) so unexpected or missing fields never
//! break a sync. Decimals arrive as JSON numbers and are parsed exactly via
//! rust_decimal's arbitrary-precision serde adapter (no float step).

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
