//! What the admin endpoints send and accept.

use gripsou_providers::registry::{AccountKind, Context, Keyed, Providers};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: gripsou_core::repo::user::Role,
    pub joined_at: i64,
    pub is_self: bool,
    pub avatar: Option<String>,
}

impl User {
    pub fn from_row(r: gripsou_core::repo::user::UserRow, current_id: uuid::Uuid) -> Self {
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

#[derive(serde::Deserialize, TS)]
pub struct DeleteUserReq {
    pub email: String,
}

#[derive(Debug, Deserialize, TS)]
pub struct SetRoleReq {
    pub role: gripsou_core::repo::user::Role,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub key: String,
    pub display_name: String,
    pub description: String,
    pub enabled: bool,
}

impl Provider {
    pub fn new(k: &AccountKind, enabled: bool) -> Self {
        Provider {
            key: k.about.key.into(),
            display_name: k.about.display_name.into(),
            description: k.description.into(),
            enabled,
        }
    }
}

#[derive(Debug, Deserialize, TS)]
pub struct SetProviderReq {
    pub enabled: bool,
}

/// What a provider's keys are for: the first-run server setup shows one
/// section per group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum KeyGroup {
    Bank,
    Categorize,
    Logos,
}

/// One provider's keys for Settings → Server. A secret's value never leaves
/// the server: only whether it is set.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyProvider {
    pub key: String,
    pub display_name: String,
    pub group: KeyGroup,
    /// Whether the saved keys are enough for what the group enables.
    pub ready: bool,
    /// For a bank provider, the address its console must allow, as the server
    /// sends it: the browser's own address can differ.
    pub return_address: Option<String>,
    pub fields: Vec<ApiKeyField>,
}

/// `secret` tells the frontend which of the two shapes it is.
#[derive(Debug, Serialize, PartialEq, Eq, TS)]
#[serde(untagged)]
pub enum ApiKeyField {
    Plain {
        key: String,
        label: String,
        #[ts(type = "false")]
        secret: bool,
        value: Option<String>,
    },
    Secret {
        key: String,
        label: String,
        #[ts(type = "true")]
        secret: bool,
        set: bool,
    },
}

impl ApiKeyProvider {
    pub fn new(keyed: Keyed, providers: &Providers, ctx: &Context) -> Self {
        let config = providers.config();
        let k = keyed.about();
        let (group, ready, return_address) = match keyed {
            // A webhook secret is optional: the adapter is built without one.
            Keyed::Bank(kind) => (
                KeyGroup::Bank,
                providers.account(kind.about.key).is_some(),
                Some(ctx.callback_url()),
            ),
            Keyed::Categorize(kind) => (KeyGroup::Categorize, (kind.configured)(config), None),
            Keyed::Logos(about) => (
                KeyGroup::Logos,
                about
                    .fields
                    .iter()
                    .all(|f| config.get(about.key, f.key).is_some()),
                None,
            ),
        };
        let fields = k
            .fields
            .iter()
            .map(|f| {
                let value = config.get(k.key, f.key);
                if f.secret {
                    ApiKeyField::Secret {
                        key: f.key.into(),
                        label: f.label.into(),
                        secret: true,
                        set: value.is_some(),
                    }
                } else {
                    ApiKeyField::Plain {
                        key: f.key.into(),
                        label: f.label.into(),
                        secret: false,
                        value: value.map(str::to_string),
                    }
                }
            })
            .collect();
        ApiKeyProvider {
            key: k.key.into(),
            display_name: k.display_name.into(),
            group,
            ready,
            return_address,
            fields,
        }
    }
}

#[derive(Debug, Deserialize, TS)]
#[ts(optional_fields = nullable)]
pub struct SetApiKeyReq {
    pub field: String,
    pub value: Option<String>,
}

#[derive(Debug, serde::Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct InviteLinkResp {
    pub token: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "BudgetAiSettings")]
pub struct BudgetAiSettingsDto {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub available: Vec<&'static str>,
    pub defaults: std::collections::BTreeMap<&'static str, &'static str>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields = nullable)]
pub struct SetBudgetAiSettingsReq {
    pub provider: Option<String>,
    pub model: Option<String>,
}

/// AI spend for Settings → Server. Token counts are numbers; money is strings.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "BudgetAiUsage")]
pub struct BudgetAiUsageDto {
    pub currency: &'static str,
    pub models: Vec<BudgetAiModelUsageDto>,
    pub total_cost: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "BudgetAiModelUsage")]
pub struct BudgetAiModelUsageDto {
    pub model: String,
    pub runs: i64,
    pub runs_without_usage: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub price_in: Option<String>,
    pub price_out: Option<String>,
    /// `None` when the model has no price entered.
    pub cost: Option<String>,
}

/// One entry of the `PUT /settings/budget-ai/prices` map, USD per million
/// tokens as decimal strings. Parsed by the handler so bad values are a 400.
#[derive(Deserialize, TS)]
pub struct BudgetAiPriceReq {
    #[serde(rename = "in")]
    pub input: String,
    #[serde(rename = "out")]
    pub output: String,
}
