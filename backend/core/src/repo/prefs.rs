//! Per-user preferences. The settings the server reads are `users` columns
//! (`currency`, `time_zone`, `budget_ai_enabled`, `budget_ai_threshold`), with
//! their defaults in the schema. The display-only ones are the JSON in
//! `users.prefs`. The API sends and accepts both as one object.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPrefs {
    #[serde(flatten)]
    pub display: DisplayPrefs,
    /// ISO code of the currency this user reads their figures in.
    pub currency: String,
    /// IANA timezone shared by background syncs and browser date defaults.
    pub time_zone: String,
    /// The user's opt-in to AI categorisation.
    pub budget_ai_enabled: bool,
    /// Review threshold, as an integer percent. An AI guess below it goes to
    /// the review queue. Always within [`BUDGET_AI_THRESHOLD_RANGE`].
    pub budget_ai_threshold: u8,
}

/// Preferences only the frontend reads, stored as JSON in `users.prefs`. Every
/// field has a serde default so an empty or partial object reads back whole.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPrefs {
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
    #[serde(default = "default_currency_position")]
    pub currency_position: String,
    #[serde(default = "default_percent_decimals")]
    pub percent_decimals: u8,
    /// Masks the headline net-worth figure. Display-only: the API still sends
    /// the real amounts.
    #[serde(default)]
    pub private_mode: bool,
    /// The user's own bookkeeping column in the budget transactions table. The
    /// pipeline never reads it.
    #[serde(default)]
    pub show_checked: bool,
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
fn default_currency_position() -> String {
    "after".to_string()
}
fn default_percent_decimals() -> u8 {
    2
}

impl Default for DisplayPrefs {
    fn default() -> Self {
        serde_json::from_str("{}").expect("every display pref has a default")
    }
}

/// The review threshold a user who never moved the slider gets, in percent.
/// Matches the column default.
pub const DEFAULT_BUDGET_AI_THRESHOLD: u8 = 70;

/// The review thresholds a user may pick, in percent. Matches the column's check.
pub const BUDGET_AI_THRESHOLD_RANGE: std::ops::RangeInclusive<u8> = 50..=95;

/// Whether `code` has the shape of an ISO 4217 code, as the column's check requires.
pub fn valid_currency(code: &str) -> bool {
    code.len() == 3 && code.bytes().all(|b| b.is_ascii_uppercase())
}

/// The reader's review threshold as a fraction (`0.70`), which is what the
/// review rule compares `category_confidence` against.
pub async fn review_threshold(
    pool: &sqlx::PgPool,
    user_id: uuid::Uuid,
) -> Result<rust_decimal::Decimal, crate::error::CoreError> {
    let pct = sqlx::query_scalar!(
        "select budget_ai_threshold from users where id = $1",
        user_id
    )
    .fetch_one(pool)
    .await?;
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
            select id, budget_ai_enabled as enabled
            from users where id = $1
            for update
        )
        update users u
           set prefs = $2, currency = $3, time_zone = $4,
               budget_ai_enabled = $5, budget_ai_threshold = $6
          from old
         where u.id = old.id
        returning old.enabled
        "#,
        user_id,
        sqlx::types::Json(&prefs.display) as _,
        prefs.currency,
        prefs.time_zone,
        prefs.budget_ai_enabled,
        prefs.budget_ai_threshold as i16,
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
    Ok(
        sqlx::query_scalar!("select budget_ai_enabled from users where id = $1", user_id)
            .fetch_one(pool)
            .await?,
    )
}

/// PostgreSQL owns timezone rules for every server-side calendar calculation.
pub async fn today(
    pool: &sqlx::PgPool,
    user_id: uuid::Uuid,
) -> Result<chrono::NaiveDate, crate::error::CoreError> {
    Ok(
        sqlx::query_scalar!("select user_today($1) as \"day!\"", user_id)
            .fetch_one(pool)
            .await?,
    )
}

pub async fn valid_time_zone(
    pool: &sqlx::PgPool,
    zone: &str,
) -> Result<bool, crate::error::CoreError> {
    Ok(sqlx::query_scalar!(
        "select exists(select 1 from pg_timezone_names where name = $1 and (name = 'UTC' or name like '%/%') and name not like 'posix/%' and name not like 'right/%') as \"valid!\"",
        zone
    )
    .fetch_one(pool)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_object_reads_back_whole() {
        let p: DisplayPrefs = serde_json::from_str("{}").unwrap();
        assert_eq!(p.ui_language, "en");
        assert_eq!(p.number_decimal_sep, ",");
        assert!(!p.show_checked);
    }

    #[test]
    fn the_api_object_is_flat_and_camel_case() {
        let p = UserPrefs {
            display: DisplayPrefs::default(),
            currency: "CNY".into(),
            time_zone: "UTC".into(),
            budget_ai_enabled: true,
            budget_ai_threshold: 65,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["currency"], "CNY");
        assert_eq!(json["budgetAiThreshold"], 65);
        assert_eq!(json["uiLanguage"], "en");
        let back: UserPrefs = serde_json::from_value(json).unwrap();
        assert_eq!(back.time_zone, "UTC");
    }

    #[test]
    fn currency_codes_are_three_capitals() {
        assert!(valid_currency("USD"));
        assert!(!valid_currency("usd"));
        assert!(!valid_currency("EURO"));
    }
}
