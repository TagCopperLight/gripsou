//! JSON response shapes for the read API. Money/quantities are strings
//! (decimals never go over the wire as floats); timestamps are epoch-ms.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

fn day_to_millis(d: NaiveDate) -> i64 {
    d.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthPoint {
    pub t: i64,
    pub net_worth: String,
    pub invested: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthSummary {
    pub net_worth: String,
    pub invested: String,
    pub gain_abs: String,
    pub gain_pct: String,
}

#[derive(Serialize)]
pub struct NetWorthResponse {
    pub points: Vec<NetWorthPoint>,
    pub summary: NetWorthSummary,
}

impl NetWorthResponse {
    /// Build from net-worth rows. `gain*` compares the last vs first point.
    pub fn from_rows(rows: &[gripsou_core::repo::query::NetWorthRow]) -> Self {
        let points: Vec<NetWorthPoint> = rows
            .iter()
            .map(|r| NetWorthPoint {
                t: day_to_millis(r.as_of),
                net_worth: r.net_worth.to_string(),
                invested: r.invested.to_string(),
            })
            .collect();

        let (first, last) = match (rows.first(), rows.last()) {
            (Some(f), Some(l)) => (f.net_worth, l.net_worth),
            _ => (Decimal::ZERO, Decimal::ZERO),
        };
        let gain_abs = last - first;
        let gain_pct = if first.is_zero() {
            Decimal::ZERO
        } else {
            (gain_abs / first).round_dp(4)
        };
        let invested = rows.last().map(|r| r.invested).unwrap_or(Decimal::ZERO);

        NetWorthResponse {
            points,
            summary: NetWorthSummary {
                net_worth: last.to_string(),
                invested: invested.to_string(),
                gain_abs: gain_abs.to_string(),
                gain_pct: gain_pct.to_string(),
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionAccount {
    pub id: String,
    pub name: String,
    pub category: String,
    pub color: String,
    pub value: String,
}

impl DistributionAccount {
    pub fn from_row(r: gripsou_core::repo::query::DistributionRow) -> Self {
        DistributionAccount {
            id: r.account_id.to_string(),
            name: r.name,
            category: r.category,
            color: r.color.unwrap_or_else(|| "#888888".to_string()),
            value: r.value.to_string(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Holding {
    pub id: String,
    pub ticker: String,
    pub name: String,
    pub kind: String,
    pub logo: String,
    pub account_id: String,
    pub account_name: String,
    pub account_color: String,
    pub category: String,
    pub qty: String,
    pub price: String,
    pub invested: String,
    pub value: String,
    pub gl: String,
    pub gl_pct: String,
    pub spark: Option<Vec<String>>,
}

impl Holding {
    pub fn from_row(r: gripsou_core::repo::query::HoldingRow) -> Self {
        let is_cash = r.kind == "cash";
        let price = r
            .price
            .unwrap_or(if is_cash { Decimal::ONE } else { Decimal::ZERO });
        let value = if is_cash {
            r.quantity
        } else {
            r.quantity * price
        };
        let gl = value - r.cost_basis;
        let gl_pct = if r.cost_basis.is_zero() {
            Decimal::ZERO
        } else {
            (gl / r.cost_basis).round_dp(4)
        };
        let spark = if is_cash || r.spark.is_empty() {
            None
        } else {
            Some(r.spark.iter().map(|d| d.to_string()).collect())
        };

        Holding {
            id: r.holding_id.to_string(),
            ticker: r.symbol.unwrap_or_else(|| r.currency.clone()),
            name: r.instrument_name,
            kind: r.kind,
            logo: r.logo_url.unwrap_or_else(|| {
                r.account_color
                    .clone()
                    .unwrap_or_else(|| "#888888".to_string())
            }),
            account_id: r.account_id.to_string(),
            account_name: r.account_name,
            account_color: r.account_color.unwrap_or_else(|| "#888888".to_string()),
            category: r.category,
            qty: r.quantity.to_string(),
            price: price.to_string(),
            invested: r.cost_basis.to_string(),
            value: value.to_string(),
            gl: gl.to_string(),
            gl_pct: gl_pct.to_string(),
            spark,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PricePoint {
    pub t: i64,
    pub price: String,
}

impl PricePoint {
    pub fn from_row(r: gripsou_core::repo::query::PricePointRow) -> Self {
        PricePoint {
            t: r.ts.timestamp_millis(),
            price: r.unit_price.to_string(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Purchase {
    pub t: i64,
    pub qty: String,
    pub price: String,
    pub invested: String,
}

impl Purchase {
    pub fn from_row(r: gripsou_core::repo::query::TxnRow) -> Self {
        Purchase {
            t: r.ts.timestamp_millis(),
            qty: r.quantity.unwrap_or(Decimal::ZERO).to_string(),
            price: r.unit_price.unwrap_or(Decimal::ZERO).to_string(),
            invested: r.amount.to_string(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub color: String,
    pub type_key: String,
    pub type_label: String,
    pub value: String,
    pub last_sync_at: Option<i64>,
}

impl Account {
    pub fn from_row(r: gripsou_core::repo::query::AccountRow) -> Self {
        Account {
            id: r.account_id.to_string(),
            name: r.name,
            color: r.color.unwrap_or_else(|| "#888888".to_string()),
            type_key: r.type_key,
            type_label: r.type_label,
            value: r.value.to_string(),
            last_sync_at: r.last_sync_at.map(|d| d.timestamp_millis()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesAccount {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Serialize)]
pub struct SeriesPoint {
    pub t: i64,
    /// account id -> value (decimal string).
    pub values: std::collections::HashMap<String, String>,
}

#[derive(Serialize)]
pub struct AccountSeriesResponse {
    pub accounts: Vec<SeriesAccount>,
    pub points: Vec<SeriesPoint>,
}

impl AccountSeriesResponse {
    /// Pivot flat (account, day, value) rows into account list + per-day value maps.
    /// Rows must be ordered by day (the query guarantees this).
    pub fn from_rows(rows: Vec<gripsou_core::repo::query::AccountSeriesRow>) -> Self {
        use std::collections::{HashMap, HashSet};
        let mut accounts: Vec<SeriesAccount> = Vec::new();
        let mut seen: HashSet<uuid::Uuid> = HashSet::new();
        let mut points: Vec<SeriesPoint> = Vec::new();
        let mut idx_by_t: HashMap<i64, usize> = HashMap::new();

        for r in rows {
            let id = r.account_id.to_string();
            if seen.insert(r.account_id) {
                accounts.push(SeriesAccount {
                    id: id.clone(),
                    name: r.name,
                    color: r.color.unwrap_or_else(|| "#888888".to_string()),
                });
            }
            let t = day_to_millis(r.as_of);
            let pos = match idx_by_t.get(&t) {
                Some(&p) => p,
                None => {
                    idx_by_t.insert(t, points.len());
                    points.push(SeriesPoint {
                        t,
                        values: HashMap::new(),
                    });
                    points.len() - 1
                }
            };
            points[pos].values.insert(id, r.value.to_string());
        }

        AccountSeriesResponse { accounts, points }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountType {
    pub key: String,
    pub label: String,
    pub category: String,
}

impl AccountType {
    pub fn from_row(r: gripsou_core::repo::query::AccountTypeRow) -> Self {
        AccountType {
            key: r.key,
            label: r.label,
            category: r.category,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountReq {
    pub name: String,
    pub type_key: String,
    pub color: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedAccount {
    pub id: String,
    pub name: String,
    pub color: String,
    pub type_key: String,
    pub type_label: String,
}

impl UpdatedAccount {
    pub fn from_row(r: gripsou_core::repo::account::UpdatedAccount) -> Self {
        UpdatedAccount {
            id: r.id.to_string(),
            name: r.name,
            color: r.color.unwrap_or_else(|| "#888888".to_string()),
            type_key: r.type_key,
            type_label: r.type_label,
        }
    }
}
