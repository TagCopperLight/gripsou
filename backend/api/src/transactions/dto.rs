use gripsou_providers::brandfetch::Logos;
use serde::Serialize;
use ts_rs::TS;

use crate::wire::day_to_millis;

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    pub t: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub description: Option<String>,
    pub amount: String,
    pub amount_reporting: Option<String>,
    pub currency: String,
    pub account_id: String,
    pub account_name: String,
    pub account_color: String,
    pub source: gripsou_core::budget::vocab::RowSource,
    pub ticker: Option<String>,
    pub logo: Option<String>,
    pub quantity: Option<String>,
    pub unit_price: Option<String>,
    pub fee: Option<String>,

    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub category_default_key: Option<String>,
    pub category_color: Option<String>,
    pub category_icon: Option<String>,
    pub category_kind: Option<gripsou_core::budget::vocab::CategoryKind>,
    pub category_source: Option<gripsou_core::budget::vocab::CategorySource>,
    pub category_confidence: Option<String>,
    pub needs_review: bool,
    pub checked: bool,
    pub is_transfer: bool,
    /// Categorised by the pairing pass but its link is gone: the user corrected the other half.
    pub is_orphan_transfer: bool,
    pub tags: Vec<TransactionTag>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TransactionTag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

impl Transaction {
    pub fn from_row(
        r: gripsou_core::repo::budget::transactions::TransactionListRow,
        tags: Vec<gripsou_core::repo::budget::transactions::TagRef>,
        logos: &Logos,
    ) -> Self {
        Transaction {
            id: r.id.to_string(),
            t: day_to_millis(r.day),
            kind: r.kind,
            description: r.description,
            amount: r.amount.to_string(),
            amount_reporting: r.amount_reporting.map(|a| a.to_string()),
            currency: r.account_currency,
            account_id: r.account_id.to_string(),
            account_name: r.account_name,
            account_color: r.account_color,
            source: r.source,
            ticker: r.ticker,
            logo: r.instrument_kind.as_deref().and_then(|kind| {
                logos.instrument(
                    kind,
                    r.instrument_isin.as_deref(),
                    r.instrument_symbol.as_deref(),
                )
            }),
            quantity: r.quantity.map(|d| d.to_string()),
            unit_price: r.unit_price.map(|d| d.to_string()),
            fee: r.fee.map(|d| d.to_string()),
            category_id: r.category_id.map(|id| id.to_string()),
            category_name: r.category_name,
            category_default_key: r.category_default_key,
            category_color: r.category_color,
            category_icon: r.category_icon,
            category_kind: r.category_kind,
            category_source: r.category_source,
            category_confidence: r.category_confidence.map(|d| d.to_string()),
            needs_review: r.needs_review,
            checked: r.checked,
            is_transfer: r.is_transfer,
            is_orphan_transfer: r.is_orphan_transfer,
            tags: tags
                .into_iter()
                .map(|t| TransactionTag {
                    id: t.id.to_string(),
                    name: t.name,
                    color: t.color,
                })
                .collect(),
        }
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "TransactionCounts")]
pub struct CountsDto {
    pub matching: i64,
    pub total: i64,
    pub uncategorized: i64,
    pub selectable: i64,
    pub matching_total: String,
    /// A matching row's account leg could not be valued: `matchingTotal` is understated.
    pub fx_missing: bool,
}
