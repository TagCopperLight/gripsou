//! Per-user localization & formatting preferences, stored in `users.prefs`
//! (JSONB). Every field has a serde default so an empty/partial object round-
//! trips to sensible values without a data migration.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPrefs {
    #[serde(default = "default_ui_language")]
    pub ui_language: String,
    #[serde(default = "default_date_format")]
    pub date_format: String,
    #[serde(default = "default_group_sep")]
    pub number_group_sep: String,
    #[serde(default = "default_decimal_sep")]
    pub number_decimal_sep: String,
    #[serde(default = "default_number_decimals")]
    pub number_decimals: u8,
    /// ISO code of the currency this user reads their figures in. The symbol is
    /// derived from it on the frontend.
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default = "default_currency_position")]
    pub currency_position: String,
    #[serde(default = "default_percent_decimals")]
    pub percent_decimals: u8,
    /// Masks the headline net-worth figure on the dashboard and accounts
    /// pages. Display-only — the API still sends the real amounts.
    #[serde(default)]
    pub private_mode: bool,
    /// The user's own bookkeeping column in the budget transactions table. It
    /// confirms nothing and categorises nothing — the pipeline never reads it.
    #[serde(default)]
    pub show_checked: bool,
    /// The user's opt-in to AI categorisation. Off by default: the operator
    /// configuring a provider does not decide for every user of the instance.
    #[serde(default)]
    pub budget_ai_enabled: bool,
    /// Review threshold, as an integer percent. An AI guess below it goes to
    /// the review queue. Always within [`BUDGET_AI_THRESHOLD_RANGE`].
    #[serde(default = "default_budget_ai_threshold")]
    pub budget_ai_threshold: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
}

fn default_ui_language() -> String {
    "en".to_string()
}
fn default_date_format() -> String {
    "DD/MM/YYYY".to_string()
}
fn default_group_sep() -> String {
    " ".to_string()
}
fn default_decimal_sep() -> String {
    ",".to_string()
}
fn default_number_decimals() -> u8 {
    2
}
fn default_currency() -> String {
    "EUR".to_string()
}
fn default_currency_position() -> String {
    "after".to_string()
}
fn default_percent_decimals() -> u8 {
    2
}
/// The review threshold a user who never moved the slider gets, in percent.
pub const DEFAULT_BUDGET_AI_THRESHOLD: u8 = 70;

/// The review thresholds a user may pick, in percent. The API refuses
/// anything outside it, and a stored value outside it is clamped on read.
pub const BUDGET_AI_THRESHOLD_RANGE: std::ops::RangeInclusive<u8> = 50..=95;

fn default_budget_ai_threshold() -> u8 {
    DEFAULT_BUDGET_AI_THRESHOLD
}

impl Default for UserPrefs {
    fn default() -> Self {
        UserPrefs {
            ui_language: default_ui_language(),
            date_format: default_date_format(),
            number_group_sep: default_group_sep(),
            number_decimal_sep: default_decimal_sep(),
            number_decimals: default_number_decimals(),
            currency: default_currency(),
            currency_position: default_currency_position(),
            percent_decimals: default_percent_decimals(),
            private_mode: false,
            show_checked: false,
            budget_ai_enabled: false,
            budget_ai_threshold: default_budget_ai_threshold(),
            avatar: None,
        }
    }
}

/// The currency the reader wants figures in. `EUR` when unset — the same
/// default every valuation query already applies inline.
pub async fn reporting_currency(
    pool: &sqlx::PgPool,
    user_id: uuid::Uuid,
) -> Result<String, crate::error::CoreError> {
    let code: Option<String> = sqlx::query_scalar!(
        "select prefs->>'currency' from users where id = $1",
        user_id
    )
    .fetch_one(pool)
    .await?;
    Ok(code.unwrap_or_else(|| "EUR".to_string()))
}

/// The reader's review threshold as a fraction (`0.70`), which is what the
/// review rule compares `category_confidence` against.
pub async fn review_threshold(
    pool: &sqlx::PgPool,
    user_id: uuid::Uuid,
) -> Result<rust_decimal::Decimal, crate::error::CoreError> {
    let pct: Option<i32> = sqlx::query_scalar!(
        "select (prefs->>'budgetAiThreshold')::int from users where id = $1",
        user_id
    )
    .fetch_one(pool)
    .await?;
    let pct = pct.unwrap_or(DEFAULT_BUDGET_AI_THRESHOLD as i32).clamp(
        *BUDGET_AI_THRESHOLD_RANGE.start() as i32,
        *BUDGET_AI_THRESHOLD_RANGE.end() as i32,
    );
    Ok(rust_decimal::Decimal::new(pct as i64, 2))
}

/// Replaces the user's preferences and says whether AI categorisation was on
/// before, in one statement: the row is locked while it is read, so of two
/// concurrent requests turning AI on, only one sees it as having been off.
/// `None` when the user does not exist.
pub async fn replace_prefs(
    pool: &sqlx::PgPool,
    user_id: uuid::Uuid,
    prefs: &UserPrefs,
) -> Result<Option<bool>, crate::error::CoreError> {
    let was_enabled = sqlx::query_scalar!(
        r#"
        with old as (
            select id, coalesce((prefs->>'budgetAiEnabled')::boolean, false) as enabled
            from users where id = $1
            for update
        )
        update users u set prefs = $2
          from old
         where u.id = old.id
        returning old.enabled as "enabled!"
        "#,
        user_id,
        sqlx::types::Json(prefs) as _,
    )
    .fetch_optional(pool)
    .await?;
    Ok(was_enabled)
}

/// Whether this user has opted in to AI categorisation.
pub async fn budget_ai_enabled(
    pool: &sqlx::PgPool,
    user_id: uuid::Uuid,
) -> Result<bool, crate::error::CoreError> {
    let on: Option<bool> = sqlx::query_scalar!(
        "select (prefs->>'budgetAiEnabled')::boolean from users where id = $1",
        user_id
    )
    .fetch_one(pool)
    .await?;
    Ok(on.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_object_yields_defaults() {
        let p: UserPrefs = serde_json::from_str("{}").unwrap();
        assert_eq!(p.ui_language, "en");
        assert_eq!(p.date_format, "DD/MM/YYYY");
        assert_eq!(p.number_group_sep, " ");
        assert_eq!(p.number_decimal_sep, ",");
        assert_eq!(p.number_decimals, 2);
        assert_eq!(p.currency, "EUR");
        assert_eq!(p.currency_position, "after");
        assert_eq!(p.percent_decimals, 2);
        assert!(!p.private_mode);
    }

    #[test]
    fn currency_defaults_to_the_pivot_code() {
        let p: UserPrefs = serde_json::from_str("{}").unwrap();
        assert_eq!(p.currency, "EUR");
    }

    #[test]
    fn currency_round_trips_as_a_code() {
        let p: UserPrefs = serde_json::from_str(r#"{"currency":"CNY"}"#).unwrap();
        assert_eq!(p.currency, "CNY");
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"currency\":\"CNY\""));
    }

    #[test]
    fn partial_object_fills_remaining_defaults() {
        let p: UserPrefs =
            serde_json::from_str(r#"{"uiLanguage":"fr","currencyPosition":"before"}"#).unwrap();
        assert_eq!(p.ui_language, "fr");
        assert_eq!(p.currency_position, "before");
        // Untouched fields fall back to defaults.
        assert_eq!(p.number_decimal_sep, ",");
        assert_eq!(p.number_decimals, 2);
    }

    #[test]
    fn round_trips_camelcase() {
        let json = serde_json::to_string(&UserPrefs::default()).unwrap();
        assert!(json.contains("\"uiLanguage\""));
        assert!(json.contains("\"numberGroupSep\""));
    }

    #[test]
    fn show_checked_defaults_to_false_and_round_trips() {
        let p: UserPrefs = serde_json::from_str("{}").unwrap();
        assert!(!p.show_checked);

        let p: UserPrefs = serde_json::from_str(r#"{"showChecked":true}"#).unwrap();
        assert!(p.show_checked);
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"showChecked\":true"));
    }

    #[test]
    fn budget_ai_defaults_off_at_seventy_percent() {
        let p: UserPrefs = serde_json::from_str("{}").unwrap();
        assert!(!p.budget_ai_enabled);
        assert_eq!(p.budget_ai_threshold, 70);
    }

    #[test]
    fn budget_ai_round_trips_camelcase() {
        let p: UserPrefs =
            serde_json::from_str(r#"{"budgetAiEnabled":true,"budgetAiThreshold":65}"#).unwrap();
        assert!(p.budget_ai_enabled);
        assert_eq!(p.budget_ai_threshold, 65);
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"budgetAiEnabled\":true"));
        assert!(json.contains("\"budgetAiThreshold\":65"));
    }
}
