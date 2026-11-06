//! What the transactions list sends.

use gripsou_providers::brandfetch::Logos;
use serde::Serialize;

use crate::wire::day_to_millis;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    /// Epoch milliseconds at UTC midnight of the day, like every other date
    /// in this API.
    pub t: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub description: Option<String>,
    /// Decimal string in `currency` — never a float.
    pub amount: String,
    /// The same movement in the reader's currency at the transaction's own
    /// date. Decimal string, never a float; null when no rate applies.
    pub amount_reporting: Option<String>,
    pub currency: String,
    pub account_id: String,
    pub account_name: String,
    pub account_color: String,
    /// `"cash"` for a `transaction` row, `"lot"` for a purchase/sale. The
    /// frontend picks its rendering (and i18n) off this discriminator.
    pub source: String,
    pub ticker: Option<String>,
    /// The instrument's logo on a lot row; null on a cash row.
    pub logo: Option<String>,
    /// Decimal string, never a float.
    pub quantity: Option<String>,
    /// Decimal string, never a float.
    pub unit_price: Option<String>,
    /// Decimal string, never a float.
    pub fee: Option<String>,

    // ── Budget ──────────────────────────────────────────────────────────────
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    /// Translate this when present; fall back to `category_name`.
    pub category_default_key: Option<String>,
    pub category_color: Option<String>,
    pub category_icon: Option<String>,
    pub category_kind: Option<gripsou_core::budget::vocab::CategoryKind>,
    pub category_source: Option<gripsou_core::budget::vocab::CategorySource>,
    /// Decimal string, never a float.
    pub category_confidence: Option<String>,
    pub needs_review: bool,
    pub checked: bool,
    /// One half of an auto-paired internal transfer.
    pub is_transfer: bool,
    /// The pairing pass categorised this row but its link is gone — a user
    /// corrected the other half, so this one nets against nothing.
    pub is_orphan_transfer: bool,
    pub tags: Vec<TransactionTag>,
}

#[derive(Serialize)]
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountsDto {
    pub matching: i64,
    pub total: i64,
    pub uncategorized: i64,
    /// The cash rows among `matching`: what "select all shown" selects.
    pub selectable: i64,
    /// Decimal as a string, per the project convention. The `selectable`
    /// rows' sum.
    pub matching_total: String,
    /// At least one matching row's account leg could not be valued, so
    /// `matchingTotal` is understated by whatever that row was worth. Same
    /// convention as `SummaryDto.fxMissing`.
    pub fx_missing: bool,
}
