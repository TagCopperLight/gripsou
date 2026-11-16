use chrono::NaiveDate;
use gripsou_providers::brandfetch::Logos;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::wire::{day_to_millis, ratio};

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Holding {
    pub id: String,
    pub ticker: String,
    pub name: String,
    pub kind: String,
    pub logo: Option<String>,
    pub account_id: String,
    pub account_name: String,
    pub account_color: String,
    pub account_type: String,
    pub qty: String,
    /// Unit price, denominated in `price_currency`, not in `currency`.
    pub price: String,
    /// The instrument's quote currency: labelling only, no amount here is in it.
    pub currency: String,
    pub price_currency: String,
    /// The account's currency: `invested_native` and every figure on the holding's transactions are in it.
    pub account_currency: String,
    pub invested: String,
    pub invested_native: String,
    pub value: String,
    /// `qty * price` in `price_currency`, shown when `fx_missing` leaves `value` at zero.
    pub value_native: Option<String>,
    pub gl: String,
    pub gl_pct: String,
    pub fx_missing: bool,
    pub spark: Option<Vec<String>>,
    pub composition: Option<gripsou_core::dto::Composition>,
    pub unexplained_qty: String,
    /// Fee-inclusive mean buy price in the account's currency; the basis over the quantity when no buy is recorded.
    pub mean_price: String,
}

impl Holding {
    pub fn from_row(r: gripsou_core::repo::valuation::HoldingRow, logos: &Logos) -> Self {
        let gl = r.value - r.invested;
        let kind = r.display_kind().to_string();
        let price = r.unit_price().to_string();
        let price_currency = r.unit_price_currency().to_string();
        let value_native = r.value_native().map(|v| v.to_string());
        let spark = r.spark().map(|s| s.iter().map(|d| d.to_string()).collect());
        Holding {
            id: r.holding_id.to_string(),
            ticker: r.symbol.unwrap_or_else(|| r.currency.clone()),
            name: r.instrument_name,
            kind,
            logo: logos.instrument(
                &r.kind,
                r.instrument_isin.as_deref(),
                r.instrument_symbol.as_deref(),
            ),
            account_id: r.account_id.to_string(),
            account_name: r.account_name,
            account_color: r.account_color,
            account_type: r.type_key,
            qty: r.quantity.to_string(),
            price,
            price_currency,
            value_native,
            spark,
            gl_pct: ratio(gl, r.invested).to_string(),
            currency: r.currency,
            account_currency: r.account_currency,
            invested: r.invested.to_string(),
            invested_native: r.invested_native.to_string(),
            value: r.value.to_string(),
            gl: gl.to_string(),
            fx_missing: r.fx_missing,
            composition: r.composition,
            unexplained_qty: r.unexplained_quantity.to_string(),
            mean_price: r.mean_price.to_string(),
        }
    }
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct LotEntry {
    #[serde(rename = "type")]
    pub kind: gripsou_core::repo::lot::LotSide,
    pub date: NaiveDate,
    pub quantity: String,
    pub unit_price: String,
    pub fee: Option<String>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SaveLotsReq {
    #[serde(default)]
    #[ts(optional = nullable)]
    pub adds: Vec<LotEntry>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub deletes: Vec<uuid::Uuid>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Lot {
    pub id: String,
    pub t: i64,
    pub side: gripsou_core::repo::lot::LotSide,
    pub qty: String,
    pub price: String,
    pub fee: String,
    pub manual: bool,
}

impl Lot {
    pub fn from_row(r: gripsou_core::repo::lot::LotRow) -> Self {
        Lot {
            id: r.id.to_string(),
            t: day_to_millis(r.acquired_on),
            side: r.side,
            qty: r.quantity.to_string(),
            price: r.unit_price.to_string(),
            fee: r.fee.to_string(),
            manual: r.manual,
        }
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LotSuggestion {
    #[serde(rename = "type")]
    pub kind: gripsou_core::repo::lot::LotSide,
    pub date: NaiveDate,
    pub quantity: String,
    pub unit_price: String,
    pub fee: String,
}

impl LotSuggestion {
    pub fn from_suggestion(s: gripsou_core::repo::lot_suggest::Suggestion) -> Self {
        LotSuggestion {
            kind: s.side,
            date: s.date,
            quantity: s.quantity.to_string(),
            unit_price: s.unit_price.to_string(),
            fee: s.fee.to_string(),
        }
    }
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLotsReq {
    pub rows: Vec<LotEntry>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BasisPreview {
    #[serde(flatten)]
    pub account: BasisFigures,
    pub reporting: Option<BasisFigures>,
}

impl BasisPreview {
    pub fn from_core(p: gripsou_core::repo::lot::BasisPreview) -> Self {
        BasisPreview {
            account: BasisFigures::from_core(p.account),
            reporting: p.reporting.map(BasisFigures::from_core),
        }
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BasisFigures {
    pub mean_price: String,
    pub invested: String,
    pub realised: String,
    pub unrealised: Option<String>,
}

impl BasisFigures {
    fn from_core(f: gripsou_core::repo::lot::BasisFigures) -> Self {
        BasisFigures {
            mean_price: f.mean_price.to_string(),
            invested: f.invested.to_string(),
            realised: f.realised.to_string(),
            unrealised: f.unrealised.map(|u| u.to_string()),
        }
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PricePoint {
    pub t: i64,
    pub price: String,
    pub account_price: Option<String>,
    pub reporting_price: Option<String>,
    pub qty: Option<String>,
    pub invested: Option<String>,
    pub reporting_invested: Option<String>,
}

impl PricePoint {
    pub fn from_row(r: gripsou_core::repo::valuation::PricePointRow) -> Self {
        PricePoint {
            t: r.ts.timestamp_millis(),
            price: r.unit_price.to_string(),
            account_price: r.account_price.map(|p| p.to_string()),
            reporting_price: r.reporting_price.map(|p| p.to_string()),
            qty: r.qty.map(|q| q.to_string()),
            invested: r.invested.map(|i| i.to_string()),
            reporting_invested: r.reporting_invested.map(|i| i.to_string()),
        }
    }
}

/// `annualised` is a ratio per year ("0.0712"). `gain` is value + received - invested, `gain_pct` its ratio to `invested`.
/// Each is null when a rate it needs is missing; all leave out the same holdings, counted by reason.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReturnFigures {
    pub annualised: Option<String>,
    pub since: Option<String>,
    pub invested: Option<String>,
    pub received: Option<String>,
    pub value: String,
    pub gain: Option<String>,
    pub gain_pct: Option<String>,
    /// Left out: the recorded purchases and sales don't explain what is held.
    pub excluded_history: usize,
    /// Left out: no exchange rate to value it today.
    pub excluded_rate: usize,
}

impl ReturnFigures {
    pub fn from_scope(s: &gripsou_core::returns::ScopeReturn) -> Self {
        let invested = s.invested_cents();
        let gain = s.gain();
        ReturnFigures {
            annualised: s.annualised.map(|r| format!("{r:.4}")),
            since: s.since.map(|d| d.to_string()),
            invested: invested.map(|d| d.to_string()),
            received: s.received_cents().map(|d| d.to_string()),
            value: s.value.to_string(),
            gain: gain.map(|d| d.to_string()),
            gain_pct: invested.zip(gain).map(|(i, g)| ratio(g, i).to_string()),
            excluded_history: s.missing.len(),
            excluded_rate: s.unvalued.len(),
        }
    }
}

#[derive(Serialize, TS)]
pub struct MissingHolding {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReturnAccount {
    pub id: String,
    pub name: String,
    pub color: String,
    pub source: String,
    pub missing: Vec<MissingHolding>,
    #[serde(flatten)]
    pub figures: ReturnFigures,
}

#[derive(Serialize, TS)]
pub struct InvestmentReturns {
    pub today: String,
    pub total: ReturnFigures,
    pub accounts: Vec<ReturnAccount>,
}
