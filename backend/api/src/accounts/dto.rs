//! What the accounts and net-worth endpoints send and accept.

use gripsou_providers::brandfetch::Logos;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::connections::dto::provider_name;
use crate::wire::{day_to_millis, ratio};

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthPoint {
    pub t: i64,
    /// Null when the reader's currency has no rate that day: a gap, not a zero.
    pub net_worth: Option<String>,
    pub invested: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetWorthSummary {
    pub net_worth: String,
    pub invested: String,
    pub gain_abs: String,
    pub gain_pct: String,
    pub fx_missing: bool,
}

#[derive(Serialize, TS)]
pub struct NetWorthResponse {
    pub points: Vec<NetWorthPoint>,
    pub summary: NetWorthSummary,
}

impl NetWorthResponse {
    /// Build from net-worth rows. The headline is the last point; `gain*`
    /// compares the first and last points that have a value.
    pub fn from_rows(rows: &[gripsou_core::repo::valuation::NetWorthRow]) -> Self {
        let points: Vec<NetWorthPoint> = rows
            .iter()
            .map(|r| NetWorthPoint {
                t: day_to_millis(r.as_of),
                net_worth: r.net_worth.map(|v| v.to_string()),
                invested: r.invested.map(|v| v.to_string()),
            })
            .collect();

        let mut valued = rows.iter().filter_map(|r| r.net_worth);
        let first = valued.next().unwrap_or(Decimal::ZERO);
        let gain_abs = valued.next_back().unwrap_or(first) - first;
        let gain_pct = ratio(gain_abs, first);
        let last = rows.last();
        let net_worth = last.and_then(|r| r.net_worth).unwrap_or(Decimal::ZERO);
        let invested = last.and_then(|r| r.invested).unwrap_or(Decimal::ZERO);
        let fx_missing = last.is_some_and(|r| r.fx_missing);

        NetWorthResponse {
            points,
            summary: NetWorthSummary {
                net_worth: net_worth.to_string(),
                invested: invested.to_string(),
                gain_abs: gain_abs.to_string(),
                gain_pct: gain_pct.to_string(),
                fx_missing,
            },
        }
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub connection_id: String,
    pub name: String,
    pub color: String,
    pub type_key: String,
    pub value: String,
    pub currency: String,
    pub value_native: Option<String>,
    pub fx_missing: bool,
    pub last_sync_at: Option<i64>,
    pub source_name: String,
    pub source_logo: Option<String>,
}

impl Account {
    pub fn from_row(r: gripsou_core::repo::valuation::AccountRow, logos: &Logos) -> Self {
        let source_name = source_name(&r);
        Account {
            id: r.account_id.to_string(),
            connection_id: r.connection_id.to_string(),
            name: r.name,
            color: r.color,
            type_key: r.type_key,
            value: r.value.to_string(),
            currency: r.currency,
            value_native: r.value_native.map(|v| v.to_string()),
            fx_missing: r.fx_missing,
            last_sync_at: r.last_sync_at.map(|d| d.timestamp_millis()),
            source_logo: logos.institution(&r.provider_key, r.institution_key.as_deref()),
            source_name,
        }
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SeriesAccount {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Serialize, TS)]
pub struct SeriesPoint {
    pub t: i64,
    /// account id -> value (decimal string); null when the reader's currency
    /// has no rate that day.
    pub values: std::collections::HashMap<String, Option<String>>,
}

#[derive(Serialize, TS)]
#[ts(rename = "AccountSeries")]
pub struct AccountSeriesResponse {
    pub accounts: Vec<SeriesAccount>,
    pub points: Vec<SeriesPoint>,
}

impl AccountSeriesResponse {
    /// Pivot flat (account, day, value) rows into account list + per-day value maps.
    /// Rows must be ordered by day ascending (the query guarantees this).
    ///
    /// The `accounts` list is then sorted by each account's latest in-window value
    /// descending, so the stacked chart draws the largest account on the stable
    /// zero-baseline and matches the value-ranked order of the accounts grid.
    pub fn from_rows(rows: Vec<gripsou_core::repo::valuation::AccountSeriesRow>) -> Self {
        use std::collections::{HashMap, HashSet};
        let mut accounts: Vec<SeriesAccount> = Vec::new();
        let mut seen: HashSet<uuid::Uuid> = HashSet::new();
        let mut points: Vec<SeriesPoint> = Vec::new();
        let mut idx_by_t: HashMap<i64, usize> = HashMap::new();
        // Rows arrive day-ascending, so the last value seen per account is its
        // most recent value within the window.
        let mut latest_value: HashMap<String, Option<Decimal>> = HashMap::new();

        for r in rows {
            let id = r.account_id.to_string();
            if seen.insert(r.account_id) {
                accounts.push(SeriesAccount {
                    id: id.clone(),
                    name: r.name,
                    color: r.color,
                });
            }
            latest_value.insert(id.clone(), r.value);
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
            points[pos]
                .values
                .insert(id, r.value.map(|v| v.to_string()));
        }

        // Largest latest value first; tie-break on id keeps the order stable.
        accounts.sort_by(|a, b| {
            let av = latest_value
                .get(&a.id)
                .copied()
                .flatten()
                .unwrap_or_default();
            let bv = latest_value
                .get(&b.id)
                .copied()
                .flatten()
                .unwrap_or_default();
            bv.cmp(&av).then_with(|| a.id.cmp(&b.id))
        });

        AccountSeriesResponse { accounts, points }
    }
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountReq {
    pub name: String,
    pub type_key: String,
    pub color: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedAccount {
    pub id: String,
    pub name: String,
    pub color: String,
    pub type_key: String,
}

impl UpdatedAccount {
    pub fn from_row(r: gripsou_core::repo::account::UpdatedAccount) -> Self {
        UpdatedAccount {
            id: r.id.to_string(),
            name: r.name,
            color: r.color,
            type_key: r.type_key,
        }
    }
}

/// Where an account comes from: its bank once known, else its provider.
pub fn source_name(r: &gripsou_core::repo::valuation::AccountRow) -> String {
    r.institution_name
        .clone()
        .unwrap_or_else(|| provider_name(&r.provider_key).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use gripsou_core::repo::valuation::AccountSeriesRow;
    use uuid::Uuid;

    fn row(id: Uuid, day: u32, value: i64) -> AccountSeriesRow {
        AccountSeriesRow {
            account_id: id,
            name: format!("acct-{day}"),
            color: "#888888".into(),
            as_of: NaiveDate::from_ymd_opt(2026, 1, day).unwrap(),
            value: Some(Decimal::from(value)),
        }
    }

    #[test]
    fn accounts_ordered_by_latest_value_desc() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        // Day 1: b leads. Day 2 (latest): a overtakes. Order must follow the
        // latest day, not first appearance.
        let rows = vec![row(a, 1, 10), row(b, 1, 20), row(a, 2, 100), row(b, 2, 30)];

        let resp = AccountSeriesResponse::from_rows(rows);

        let order: Vec<String> = resp.accounts.iter().map(|x| x.id.clone()).collect();
        assert_eq!(order, vec![a.to_string(), b.to_string()]);
    }

    #[test]
    fn a_day_without_a_rate_is_a_gap_and_left_out_of_the_gain() {
        use gripsou_core::repo::valuation::NetWorthRow;
        let day = |d: u32, v: Option<i64>| NetWorthRow {
            as_of: NaiveDate::from_ymd_opt(2026, 1, d).unwrap(),
            net_worth: v.map(Decimal::from),
            invested: v.map(Decimal::from),
            fx_missing: v.is_none(),
        };
        let resp =
            NetWorthResponse::from_rows(&[day(1, None), day(2, Some(100)), day(3, Some(150))]);

        assert_eq!(resp.points[0].net_worth, None);
        assert_eq!(resp.summary.gain_abs, "50");
        assert_eq!(resp.summary.gain_pct, "0.50");
    }
}
