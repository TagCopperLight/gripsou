//! Server-read settings are `users` columns; display-only ones are the JSON in `users.prefs`.
//! The API sends and accepts both as one object.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::error::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct UserPrefs {
    #[serde(flatten)]
    pub display: DisplayPrefs,
    pub currency: String,
    pub time_zone: String,
    pub budget_ai_enabled: bool,
    pub budget_ai_threshold: u8,
}

/// A missing field reads as its default, so a partial object reads back whole.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct DisplayPrefs {
    pub ui_language: String,
    pub date_format: String,
    pub number_group_sep: String,
    pub number_decimal_sep: String,
    pub number_decimals: u8,
    pub currency_position: String,
    pub percent_decimals: u8,
    /// Masks the headline net-worth figure. Display-only: the API still sends
    /// the real amounts.
    pub private_mode: bool,
    /// The pipeline never reads it.
    pub show_checked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avatar: Option<String>,
}

impl Default for DisplayPrefs {
    fn default() -> Self {
        Self {
            ui_language: "en".into(),
            date_format: "DD/MM/YYYY".into(),
            number_group_sep: " ".into(),
            number_decimal_sep: ",".into(),
            number_decimals: 2,
            currency_position: "after".into(),
            percent_decimals: 2,
            private_mode: false,
            show_checked: false,
            avatar: None,
        }
    }
}

pub const DEFAULT_BUDGET_AI_THRESHOLD: u8 = 70;

/// The column defaults of `users` (pinned by `core/tests/it/value_sets.rs`) and
/// `DisplayPrefs::default()`. The frontend shows these before anyone signs in.
impl Default for UserPrefs {
    fn default() -> Self {
        Self {
            display: DisplayPrefs::default(),
            currency: "EUR".into(),
            time_zone: "Europe/Paris".into(),
            budget_ai_enabled: false,
            budget_ai_threshold: DEFAULT_BUDGET_AI_THRESHOLD,
        }
    }
}

pub const BUDGET_AI_THRESHOLD_RANGE: std::ops::RangeInclusive<u8> = 50..=95;

pub fn threshold_fraction(percent: u8) -> Decimal {
    Decimal::new(percent.into(), 2)
}

pub fn valid_currency(code: &str) -> bool {
    code.len() == 3 && code.bytes().all(|b| b.is_ascii_uppercase())
}

struct PrefsRow {
    prefs: Json<DisplayPrefs>,
    currency: String,
    time_zone: String,
    budget_ai_enabled: bool,
    budget_ai_threshold: i16,
}

impl From<PrefsRow> for UserPrefs {
    fn from(r: PrefsRow) -> Self {
        UserPrefs {
            display: r.prefs.0,
            currency: r.currency,
            time_zone: r.time_zone,
            budget_ai_enabled: r.budget_ai_enabled,
            budget_ai_threshold: r.budget_ai_threshold as u8,
        }
    }
}

pub async fn get(
    db: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
) -> Result<Option<UserPrefs>, CoreError> {
    let row = sqlx::query_as!(
        PrefsRow,
        r#"select prefs as "prefs!: Json<DisplayPrefs>",
                  currency, time_zone, budget_ai_enabled, budget_ai_threshold
             from users where id = $1"#,
        user_id,
    )
    .fetch_optional(db)
    .await?;
    Ok(row.map(UserPrefs::from))
}

pub async fn review_threshold(pool: &PgPool, user_id: Uuid) -> Result<Decimal, CoreError> {
    let pct = sqlx::query_scalar!(
        "select budget_ai_threshold from users where id = $1",
        user_id
    )
    .fetch_one(pool)
    .await?;
    Ok(threshold_fraction(pct as u8))
}

#[derive(Debug, thiserror::Error)]
pub enum PrefsError {
    #[error("{0}")]
    Invalid(String),
    #[error("no exchange rate into {0}")]
    NoRate(String),
    #[error(transparent)]
    Core(#[from] CoreError),
}

impl From<sqlx::Error> for PrefsError {
    fn from(e: sqlx::Error) -> Self {
        Self::Core(e.into())
    }
}

/// A key set to `null` goes back to its default (or, for `avatar`, is removed). The row stays
/// locked from read to write, so two saves of different settings never undo each other.
pub async fn patch_prefs(
    pool: &PgPool,
    user_id: Uuid,
    patch: &serde_json::Map<String, serde_json::Value>,
) -> Result<bool, PrefsError> {
    let mut tx = pool.begin().await?;
    sqlx::query!("select 1 as x from users where id = $1 for update", user_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(stored) = get(&mut *tx, user_id).await? else {
        return Ok(false);
    };

    let serde_json::Value::Object(mut merged) =
        serde_json::to_value(&stored).map_err(CoreError::from)?
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
    let saved = serde_json::to_value(&prefs).map_err(CoreError::from)?;
    if let Some(key) = patch
        .iter()
        .find(|(k, v)| !v.is_null() && saved.get(k.as_str()).is_none())
        .map(|(k, _)| k)
    {
        return Err(PrefsError::Invalid(format!("unknown preference '{key}'")));
    }
    check(&mut tx, &prefs).await?;
    if prefs.currency != stored.currency
        && !crate::repo::price::has_fx_rate(&mut *tx, &prefs.currency).await?
    {
        return Err(PrefsError::NoRate(prefs.currency));
    }

    sqlx::query!(
        "update users
            set prefs = $2, currency = $3, time_zone = $4,
                budget_ai_enabled = $5, budget_ai_threshold = $6
          where id = $1",
        user_id,
        Json(&prefs.display) as _,
        prefs.currency,
        prefs.time_zone,
        prefs.budget_ai_enabled,
        prefs.budget_ai_threshold as i16,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

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

pub async fn budget_ai_enabled(pool: &PgPool, user_id: Uuid) -> Result<bool, CoreError> {
    Ok(
        sqlx::query_scalar!("select budget_ai_enabled from users where id = $1", user_id)
            .fetch_one(pool)
            .await?,
    )
}

/// SQL's `user_today(user_id)` is the same day. Market data is dated in UTC instead
/// ([`crate::repo::price::market_today`]).
pub async fn today(
    db: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
) -> Result<chrono::NaiveDate, CoreError> {
    Ok(
        sqlx::query_scalar!("select user_today($1) as \"day!\"", user_id)
            .fetch_one(db)
            .await?,
    )
}

async fn valid_time_zone(db: impl sqlx::PgExecutor<'_>, zone: &str) -> Result<bool, CoreError> {
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
