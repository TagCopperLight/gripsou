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

/// Why [`patch_prefs`] wrote nothing.
#[derive(Debug, thiserror::Error)]
pub enum PrefsError {
    /// The merged preferences break a rule; the message says which.
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Core(#[from] crate::error::CoreError),
}

impl From<sqlx::Error> for PrefsError {
    fn from(e: sqlx::Error) -> Self {
        Self::Core(e.into())
    }
}

/// Applies `patch`, some of the API object's keys, to the user's preferences:
/// a key set to `null` goes back to its default (or, for `avatar`, is removed).
/// The row stays locked from read to write, so two saves of different settings
/// never undo each other. Returns whether AI categorisation was on before, or
/// `None` when the user does not exist. Nothing is written on an error.
pub async fn patch_prefs(
    pool: &sqlx::PgPool,
    user_id: uuid::Uuid,
    patch: &serde_json::Map<String, serde_json::Value>,
) -> Result<Option<bool>, PrefsError> {
    let mut tx = pool.begin().await?;
    let Some(row) = sqlx::query!(
        r#"select prefs as "prefs!: sqlx::types::Json<DisplayPrefs>",
                  currency, time_zone, budget_ai_enabled, budget_ai_threshold
             from users where id = $1
              for update"#,
        user_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Ok(None);
    };
    let was_enabled = row.budget_ai_enabled;
    let stored = UserPrefs {
        display: row.prefs.0,
        currency: row.currency,
        time_zone: row.time_zone,
        budget_ai_enabled: row.budget_ai_enabled,
        budget_ai_threshold: row.budget_ai_threshold as u8,
    };

    let serde_json::Value::Object(mut merged) =
        serde_json::to_value(&stored).map_err(crate::error::CoreError::from)?
    else {
        unreachable!("UserPrefs serializes to an object");
    };
    for (key, value) in patch {
        if value.is_null() {
            merged.remove(key);
        } else {
            merged.insert(key.clone(), value.clone());
        }
    }
    let prefs: UserPrefs = serde_json::from_value(serde_json::Value::Object(merged))
        .map_err(|e| PrefsError::Invalid(e.to_string()))?;
    let saved = serde_json::to_value(&prefs).map_err(crate::error::CoreError::from)?;
    if let Some(key) = patch
        .iter()
        .find(|(k, v)| !v.is_null() && saved.get(k.as_str()).is_none())
        .map(|(k, _)| k)
    {
        return Err(PrefsError::Invalid(format!("unknown preference '{key}'")));
    }
    check(&mut tx, &prefs).await?;

    sqlx::query!(
        "update users
            set prefs = $2, currency = $3, time_zone = $4,
                budget_ai_enabled = $5, budget_ai_threshold = $6
          where id = $1",
        user_id,
        sqlx::types::Json(&prefs.display) as _,
        prefs.currency,
        prefs.time_zone,
        prefs.budget_ai_enabled,
        prefs.budget_ai_threshold as i16,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(was_enabled))
}

/// The rules a saved set of preferences must follow.
async fn check(db: &mut sqlx::PgConnection, prefs: &UserPrefs) -> Result<(), PrefsError> {
    let invalid = |msg: &str| Err(PrefsError::Invalid(msg.to_string()));
    if !valid_time_zone(&mut *db, &prefs.time_zone).await? {
        return invalid("timeZone must be a recognized IANA timezone");
    }
    if !valid_currency(&prefs.currency) {
        return invalid("currency must be an ISO 4217 code");
    }
    if let Some(avatar) = &prefs.display.avatar {
        if !avatar.starts_with("data:image/") {
            return invalid("avatar must be an image data URL");
        }
        if avatar.len() > 200 * 1024 {
            return invalid("avatar too large");
        }
    }
    if !BUDGET_AI_THRESHOLD_RANGE.contains(&prefs.budget_ai_threshold) {
        return Err(PrefsError::Invalid(format!(
            "budgetAiThreshold must be between {} and {}",
            BUDGET_AI_THRESHOLD_RANGE.start(),
            BUDGET_AI_THRESHOLD_RANGE.end()
        )));
    }
    Ok(())
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

async fn valid_time_zone(
    db: impl sqlx::PgExecutor<'_>,
    zone: &str,
) -> Result<bool, crate::error::CoreError> {
    Ok(sqlx::query_scalar!(
        "select exists(select 1 from pg_timezone_names where name = $1 and (name = 'UTC' or name like '%/%') and name not like 'posix/%' and name not like 'right/%') as \"valid!\"",
        zone
    )
    .fetch_one(db)
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
