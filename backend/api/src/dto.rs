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
    pub fx_missing: bool,
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
        let fx_missing = rows.last().map(|r| r.fx_missing).unwrap_or(false);

        NetWorthResponse {
            points,
            summary: NetWorthSummary {
                net_worth: last.to_string(),
                invested: invested.to_string(),
                gain_abs: gain_abs.to_string(),
                gain_pct: gain_pct.to_string(),
                fx_missing,
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionAccount {
    pub id: String,
    pub name: String,
    /// Stable account-type key; the frontend translates it via i18n.
    pub account_type: String,
    /// English account-type label — i18n fallback when the key has no locale entry.
    pub account_type_label: String,
    pub color: String,
    pub value: String,
    /// A holding in this slice could not be valued, so the slice understates.
    pub fx_missing: bool,
}

impl DistributionAccount {
    pub fn from_row(r: gripsou_core::repo::query::DistributionRow) -> Self {
        DistributionAccount {
            id: r.account_id.to_string(),
            name: r.name,
            account_type: r.type_key,
            account_type_label: r.type_label,
            color: r.color.unwrap_or_else(|| "#888888".to_string()),
            value: r.value.to_string(),
            fx_missing: r.fx_missing,
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
    pub logo: Option<String>,
    pub account_id: String,
    pub account_name: String,
    pub account_color: String,
    /// Stable account-type key; the frontend translates it via i18n.
    pub account_type: String,
    /// English account-type label — i18n fallback when the key has no locale entry.
    pub account_type_label: String,
    pub qty: String,
    /// Unit price, denominated in `price_currency` — NOT in `currency`.
    pub price: String,
    /// The instrument's quote currency. Identity/labelling only; no amount on
    /// this struct is denominated in it.
    pub currency: String,
    /// Currency of the unit price and of the price chart (the price domain).
    pub price_currency: String,
    /// The account's currency (the amount domain): `invested_native` and every
    /// figure on the holding's transactions are in it.
    pub account_currency: String,
    pub invested: String,
    pub invested_native: String,
    pub value: String,
    pub gl: String,
    pub gl_pct: String,
    pub fx_missing: bool,
    pub spark: Option<Vec<String>>,
    pub composition: Option<gripsou_core::dto::Composition>,
    /// Shares no recorded lot explains (§9.1). "0" when the position is fully
    /// accounted for. A non-zero value drives the fill-in badge.
    pub unexplained_qty: String,
}

impl Holding {
    pub fn from_row(r: gripsou_core::repo::query::HoldingRow) -> Self {
        let is_cash = r.kind == "cash";
        // Unit price is native to the instrument. A unit of cash is worth one
        // unit of its own currency by definition — its `price` row holds an FX
        // rate, which is not what this field means.
        let price = if is_cash {
            Decimal::ONE
        } else {
            r.price.unwrap_or(Decimal::ZERO)
        };
        // A unit of cash is one unit of its own currency, so that is the price
        // currency there. Otherwise it is the currency stamped on the price row
        // we read the unit price from — which may differ from the instrument's
        // (Yahoo can resolve a listing quoted elsewhere). Falling back to the
        // instrument's currency is the best available guess when no price row
        // exists at all; `price` is then zero anyway.
        let price_currency = if is_cash {
            r.currency.clone()
        } else {
            r.price_currency.unwrap_or_else(|| r.currency.clone())
        };
        let gl = r.value - r.invested;
        let gl_pct = if r.invested.is_zero() {
            Decimal::ZERO
        } else {
            (gl / r.invested).round_dp(4)
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
            logo: r.logo_url,
            account_id: r.account_id.to_string(),
            account_name: r.account_name,
            account_color: r.account_color.unwrap_or_else(|| "#888888".to_string()),
            account_type: r.type_key,
            account_type_label: r.type_label,
            qty: r.quantity.to_string(),
            price: price.to_string(),
            currency: r.currency,
            price_currency,
            account_currency: r.account_currency,
            invested: r.invested.to_string(),
            invested_native: r.invested_native.to_string(),
            value: r.value.to_string(),
            gl: gl.to_string(),
            gl_pct: gl_pct.to_string(),
            fx_missing: r.fx_missing,
            spark,
            composition: r.composition,
            unexplained_qty: r.unexplained_quantity.to_string(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LotEntry {
    /// `buy` or `sell`. Named `kind` because `type` is a Rust keyword.
    #[serde(rename = "type")]
    pub kind: String,
    pub date: NaiveDate,
    /// Decimal strings — money and quantities never cross the wire as floats.
    pub quantity: String,
    pub unit_price: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLotsReq {
    #[serde(default)]
    pub adds: Vec<LotEntry>,
    #[serde(default)]
    pub deletes: Vec<uuid::Uuid>,
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
    pub id: String,
    pub t: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub qty: String,
    pub price: String,
    /// The raw `transaction.amount`: NEGATIVE for a buy (cash out), positive for
    /// a sell. Consumers negate it once to get an invested figure — see
    /// `lib/assetSeries.ts`.
    pub invested: String,
    pub manual: bool,
}

impl Purchase {
    pub fn from_row(r: gripsou_core::repo::query::TxnRow) -> Self {
        Purchase {
            id: r.id.to_string(),
            t: r.ts.timestamp_millis(),
            kind: r.kind,
            qty: r.quantity.unwrap_or(Decimal::ZERO).to_string(),
            price: r.unit_price.unwrap_or(Decimal::ZERO).to_string(),
            invested: r.amount.to_string(),
            manual: r.manual,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    /// Epoch milliseconds, like every other timestamp in this API.
    pub t: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub description: Option<String>,
    /// Decimal string in `currency` — never a float.
    pub amount: String,
    pub currency: String,
    pub account_id: String,
    pub account_name: String,
    pub account_color: Option<String>,
}

impl Transaction {
    pub fn from_row(r: gripsou_core::repo::query::TransactionListRow) -> Self {
        Transaction {
            id: r.id.to_string(),
            t: r.ts.timestamp_millis(),
            kind: r.kind,
            description: r.description,
            amount: r.amount.to_string(),
            currency: r.account_currency,
            account_id: r.account_id.to_string(),
            account_name: r.account_name,
            account_color: r.account_color,
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
    pub fx_missing: bool,
    pub last_sync_at: Option<i64>,
    pub source_name: Option<String>,
    pub source_logo: Option<String>,
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
            fx_missing: r.fx_missing,
            last_sync_at: r.last_sync_at.map(|d| d.timestamp_millis()),
            source_logo: gripsou_core::logo::institution_logo_url(r.institution_key.as_deref()),
            source_name: r.source_name,
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
    /// Rows must be ordered by day ascending (the query guarantees this).
    ///
    /// The `accounts` list is then sorted by each account's latest in-window value
    /// descending, so the stacked chart draws the largest account on the stable
    /// zero-baseline and matches the value-ranked order of the accounts grid.
    pub fn from_rows(rows: Vec<gripsou_core::repo::query::AccountSeriesRow>) -> Self {
        use std::collections::{HashMap, HashSet};
        let mut accounts: Vec<SeriesAccount> = Vec::new();
        let mut seen: HashSet<uuid::Uuid> = HashSet::new();
        let mut points: Vec<SeriesPoint> = Vec::new();
        let mut idx_by_t: HashMap<i64, usize> = HashMap::new();
        // Rows arrive day-ascending, so the last value seen per account is its
        // most recent value within the window.
        let mut latest_value: HashMap<String, Decimal> = HashMap::new();

        for r in rows {
            let id = r.account_id.to_string();
            if seen.insert(r.account_id) {
                accounts.push(SeriesAccount {
                    id: id.clone(),
                    name: r.name,
                    color: r.color.unwrap_or_else(|| "#888888".to_string()),
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
            points[pos].values.insert(id, r.value.to_string());
        }

        // Largest latest value first; tie-break on id keeps the order stable.
        accounts.sort_by(|a, b| {
            let av = latest_value.get(&a.id).copied().unwrap_or_default();
            let bv = latest_value.get(&b.id).copied().unwrap_or_default();
            bv.cmp(&av).then_with(|| a.id.cmp(&b.id))
        });

        AccountSeriesResponse { accounts, points }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountType {
    pub key: String,
    pub label: String,
}

impl AccountType {
    pub fn from_row(r: gripsou_core::repo::query::AccountTypeRow) -> Self {
        AccountType {
            key: r.key,
            label: r.label,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAccount {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub type_label: String,
    pub value: String,
    pub last_sync_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConnection {
    pub id: String,
    pub display_name: String,
    pub status: String,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
    pub accounts: Vec<SyncAccount>,
    pub logo: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderGroup {
    pub provider_key: String,
    pub provider_name: String,
    pub connections: Vec<SyncConnection>,
}

impl ProviderGroup {
    /// Assemble the provider → connection → account tree from the two flat
    /// queries. Connection order follows `conns` (provider-grouped); accounts
    /// attach to their connection by id.
    pub fn tree(
        conns: Vec<gripsou_core::repo::connection::ConnectionListRow>,
        accounts: Vec<gripsou_core::repo::connection::ConnectionAccountRow>,
    ) -> Vec<ProviderGroup> {
        use std::collections::HashMap;
        let mut by_conn: HashMap<uuid::Uuid, Vec<SyncAccount>> = HashMap::new();
        for a in accounts {
            by_conn
                .entry(a.connection_id)
                .or_default()
                .push(SyncAccount {
                    id: a.account_id.to_string(),
                    name: a.name,
                    color: a.color,
                    type_label: a.type_label,
                    value: a.value.to_string(),
                    last_sync_at: a.last_sync_at.map(|d| d.timestamp_millis()),
                });
        }
        let mut groups: Vec<ProviderGroup> = Vec::new();
        for c in conns {
            let conn = SyncConnection {
                id: c.id.to_string(),
                logo: gripsou_core::logo::institution_logo_url(c.institution_key.as_deref()),
                // Bank/broker name once known (filled on first sync); the
                // provider label ("Powens") is a fallback until then.
                display_name: c.institution_name.unwrap_or(c.display_name),
                status: c.status,
                last_sync_at: c.last_sync_at.map(|d| d.timestamp_millis()),
                last_error: c.last_error,
                accounts: by_conn.remove(&c.id).unwrap_or_default(),
            };
            match groups.last_mut() {
                Some(g) if g.provider_key == c.provider_key => g.connections.push(conn),
                _ => groups.push(ProviderGroup {
                    provider_key: c.provider_key,
                    provider_name: c.provider_name,
                    connections: vec![conn],
                }),
            }
        }
        groups
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub id: String,
    pub status: String,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
}

impl ConnectionState {
    pub fn from_row(r: gripsou_core::repo::connection::ConnectionState) -> Self {
        ConnectionState {
            id: r.id.to_string(),
            status: r.status,
            last_sync_at: r.last_sync_at.map(|d| d.timestamp_millis()),
            last_error: r.last_error,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: String,
    pub joined_at: i64,
    pub is_self: bool,
    pub avatar: Option<String>,
}

impl User {
    pub fn from_row(r: gripsou_core::repo::query::UserRow, current_id: uuid::Uuid) -> Self {
        User {
            is_self: r.id == current_id,
            id: r.id.to_string(),
            name: r.name,
            email: r.email,
            role: r.role,
            joined_at: r.created_at.timestamp_millis(),
            avatar: r.avatar,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginReq {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub remember: bool,
}

/// The authenticated user's own profile (no `isSelf`/`joinedAt` — that's the
/// admin user-list shape). Returned by login.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: String,
    pub prefs: gripsou_core::repo::prefs::UserPrefs,
}

impl SessionUser {
    pub fn from_credentials(c: &gripsou_core::repo::user::UserCredentials) -> Self {
        SessionUser {
            id: c.id.to_string(),
            name: c.name.clone(),
            email: c.email.clone(),
            role: c.role.clone(),
            prefs: c.prefs.clone(),
        }
    }

    pub fn from_profile(p: &gripsou_core::repo::user::UserProfile) -> Self {
        SessionUser {
            id: p.id.to_string(),
            name: p.name.clone(),
            email: p.email.clone(),
            role: p.role.clone(),
            prefs: p.prefs.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    pub id: String,
    /// Friendly device label parsed from the stored User-Agent.
    pub device: String,
    pub ip: Option<String>,
    pub created_at: i64,
    pub last_active_at: i64,
    pub remembered: bool,
    /// True for the session making this request (UI marks it "This device").
    pub current: bool,
}

impl SessionDto {
    pub fn from_row(s: gripsou_core::repo::session::Session, current_id: uuid::Uuid) -> Self {
        use crate::auth;
        SessionDto {
            current: s.id == current_id,
            id: s.id.to_string(),
            device: s
                .user_agent
                .as_deref()
                .map(auth::parse_user_agent)
                .unwrap_or_else(|| "Unknown device".to_string()),
            ip: s.ip,
            created_at: s.created_at.timestamp_millis(),
            last_active_at: s.last_active_at.timestamp_millis(),
            remembered: s.remembered,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: SessionUser,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileReq {
    pub name: String,
    pub email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordReq {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAccountReq {
    /// The user re-types their own email to confirm; verified server-side as a
    /// guard against a mis-targeted request.
    pub email: String,
}

#[derive(serde::Deserialize)]
pub struct DeleteUserReq {
    pub email: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub key: String,
    pub display_name: String,
    pub description: Option<String>,
    pub enabled: bool,
}

impl Provider {
    pub fn from_row(r: gripsou_core::repo::provider::ProviderRow) -> Self {
        Provider {
            key: r.key,
            display_name: r.display_name,
            description: r.description,
            enabled: r.enabled,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SetProviderReq {
    pub enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnabledProvider {
    pub key: String,
    pub display_name: String,
    pub description: Option<String>,
}

impl EnabledProvider {
    pub fn from_row(r: gripsou_core::repo::provider::EnabledProviderRow) -> Self {
        EnabledProvider {
            key: r.key,
            display_name: r.display_name,
            description: r.description,
        }
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteLinkResp {
    pub token: String,
}

#[derive(Debug, Serialize)]
pub struct TokenInfoResp {
    #[serde(rename = "type")]
    pub token_type: String,
    pub email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedeemInviteReq {
    pub email: String,
    pub name: String,
    pub password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedeemResetReq {
    pub password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitConnectionReq {
    pub provider_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitConnectionResp {
    pub connection_id: String,
    pub redirect_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteConnectionReq {
    pub connection_id: String,
    pub params: std::collections::HashMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use gripsou_core::repo::query::AccountSeriesRow;
    use uuid::Uuid;

    fn row(id: Uuid, day: u32, value: i64) -> AccountSeriesRow {
        AccountSeriesRow {
            account_id: id,
            name: format!("acct-{day}"),
            color: None,
            as_of: NaiveDate::from_ymd_opt(2026, 1, day).unwrap(),
            value: Decimal::from(value),
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

    use gripsou_core::repo::connection::ConnectionListRow;

    fn conn_row(institution_key: Option<&str>) -> ConnectionListRow {
        ConnectionListRow {
            id: Uuid::from_u128(1),
            provider_key: "powens".into(),
            provider_name: "Powens".into(),
            display_name: "My bank".into(),
            institution_key: institution_key.map(|s| s.to_string()),
            institution_name: Some("BNP Paribas".into()),
            status: "ok".into(),
            last_sync_at: None,
            last_error: None,
        }
    }

    #[test]
    fn connection_logo_derives_from_institution_key() {
        // logo must come from the connector key via the core helper — not be
        // hardcoded and not derived from the name.
        let groups = ProviderGroup::tree(vec![conn_row(Some("some-key"))], vec![]);
        let conn = &groups[0].connections[0];
        assert_eq!(
            conn.logo,
            gripsou_core::logo::institution_logo_url(Some("some-key"))
        );
    }

    #[test]
    fn connection_logo_none_without_institution_key() {
        let groups = ProviderGroup::tree(vec![conn_row(None)], vec![]);
        assert_eq!(groups[0].connections[0].logo, None);
    }
}
