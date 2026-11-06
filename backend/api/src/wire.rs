//! Conventions every feature's JSON follows: dates go out as epoch
//! milliseconds at UTC midnight, ratios as decimal strings, chart windows as
//! one of a few named ranges.

use chrono::{Datelike, Duration, NaiveDate};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::ApiError;

pub fn day_to_millis(d: NaiveDate) -> i64 {
    d.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis()
}

/// `part / whole` to four places ("0.0712"), zero when `whole` is zero.
pub fn ratio(part: Decimal, whole: Decimal) -> Decimal {
    if whole.is_zero() {
        Decimal::ZERO
    } else {
        (part / whole).round_dp(4)
    }
}

/// A chart's window, as the range selector names it.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, ts_rs::TS)]
pub enum Range {
    #[serde(rename = "7d")]
    Week,
    #[serde(rename = "1mo")]
    Month,
    #[default]
    #[serde(rename = "6mo")]
    HalfYear,
    #[serde(rename = "1y")]
    Year,
    #[serde(rename = "ytd")]
    YearToDate,
    #[serde(rename = "max")]
    Max,
}

impl Range {
    /// In the order the range selector lists them.
    pub const ALL: [Self; 6] = [
        Self::Week,
        Self::Month,
        Self::HalfYear,
        Self::Year,
        Self::YearToDate,
        Self::Max,
    ];

    /// Inclusive calendar days ending on `today`.
    pub fn window(self, today: NaiveDate) -> (NaiveDate, NaiveDate) {
        let from = match self {
            Range::Week => today - Duration::days(7),
            Range::Month => today - Duration::days(30),
            Range::HalfYear => today - Duration::days(182),
            Range::Year => today - Duration::days(365),
            Range::YearToDate => NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap(),
            Range::Max => today - Duration::days(4000),
        };
        (from, today)
    }
}

#[derive(Deserialize)]
pub struct RangeParams {
    #[serde(default)]
    pub range: Range,
}

impl RangeParams {
    /// The window ending on the user's today, in their saved timezone.
    pub async fn window(
        &self,
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<(NaiveDate, NaiveDate), ApiError> {
        let today = gripsou_core::repo::prefs::today(pool, user_id).await?;
        Ok(self.range.window(today))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_range_uses_the_supplied_local_day() {
        let today = NaiveDate::from_ymd_opt(2027, 1, 1).unwrap();
        assert_eq!(Range::YearToDate.window(today), (today, today));
        assert_eq!(
            Range::Week.window(today),
            (NaiveDate::from_ymd_opt(2026, 12, 25).unwrap(), today)
        );
    }
}
