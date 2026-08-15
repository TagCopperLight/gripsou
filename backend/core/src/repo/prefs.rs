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
            avatar: None,
        }
    }
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
}
