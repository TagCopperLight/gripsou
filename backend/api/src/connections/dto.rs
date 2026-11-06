//! What the connection endpoints send and accept.

use chrono::NaiveDate;
use gripsou_providers::registry::{self, AccountKind, Providers};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How the provider last reached the bank (`SyncHealth`).
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SyncHealth")]
pub struct SyncHealthDto {
    pub verified: bool,
    pub last_updated_on: Option<NaiveDate>,
    pub state: Option<String>,
    pub error_message: Option<String>,
    pub next_retry_on: Option<NaiveDate>,
}

impl SyncHealthDto {
    fn new(h: gripsou_core::dto::SyncHealth) -> Self {
        SyncHealthDto {
            verified: h.verified,
            last_updated_on: h.last_updated_on,
            state: h.state,
            error_message: h.error_message,
            next_retry_on: h.next_retry_on,
        }
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SyncAccount {
    pub health: Option<SyncHealthDto>,
    pub id: String,
    pub name: String,
    pub color: String,
    pub type_key: String,
    /// Null when the reader's currency has no rate today.
    pub value: Option<String>,
    pub last_sync_at: Option<i64>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SyncConnection {
    pub can_manage: bool,
    pub health: Option<SyncHealthDto>,
    pub id: String,
    pub display_name: String,
    pub status: gripsou_core::repo::connection::ConnectionStatus,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
    pub accounts: Vec<SyncAccount>,
    pub logo: Option<String>,
}

#[derive(Serialize, TS)]
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
        providers: &Providers,
    ) -> Vec<ProviderGroup> {
        use std::collections::HashMap;
        let mut by_conn: HashMap<uuid::Uuid, Vec<SyncAccount>> = HashMap::new();
        for a in accounts {
            by_conn
                .entry(a.connection_id)
                .or_default()
                .push(SyncAccount {
                    health: a.health.map(SyncHealthDto::new),
                    id: a.account_id.to_string(),
                    name: a.name,
                    color: a.color,
                    type_key: a.type_key,
                    value: a.value.map(|v| v.to_string()),
                    last_sync_at: a.last_sync_at.map(|d| d.timestamp_millis()),
                });
        }
        let mut groups: Vec<ProviderGroup> = Vec::new();
        for c in conns {
            let conn = SyncConnection {
                can_manage: providers.supports_manage(&c.provider_key),
                health: c.health.map(SyncHealthDto::new),
                id: c.id.to_string(),
                logo: providers
                    .logos()
                    .institution(&c.provider_key, c.institution_key.as_deref()),
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
                    provider_name: provider_name(&c.provider_key).to_string(),
                    provider_key: c.provider_key,
                    connections: vec![conn],
                }),
            }
        }
        groups
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub id: String,
    pub status: gripsou_core::repo::connection::ConnectionStatus,
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

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EnabledProvider {
    pub key: String,
    pub display_name: String,
    pub description: String,
}

impl EnabledProvider {
    pub fn new(k: &AccountKind) -> Self {
        EnabledProvider {
            key: k.about.key.into(),
            display_name: k.about.display_name.into(),
            description: k.description.into(),
        }
    }
}

/// A provider's display name, or its key for one this build doesn't know.
pub fn provider_name(key: &str) -> &str {
    registry::account_kind(key).map_or(key, |k| k.about.display_name)
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct InitConnectionReq {
    pub provider_key: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct InitConnectionResp {
    pub connection_id: String,
    pub redirect_url: Option<String>,
}

#[derive(Serialize, TS)]
pub struct SyncAllResp {
    pub started: u32,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ManageResp {
    pub redirect_url: Option<String>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CompleteConnectionReq {
    pub connection_id: uuid::Uuid,
    pub params: std::collections::HashMap<String, String>,
}
