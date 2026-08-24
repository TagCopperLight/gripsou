//! Map Yahoo daily bars into canonical `PricePoint`s. The f64 → Decimal
//! conversion is the single, deliberate float boundary (Yahoo only emits f64).

use chrono::{DateTime, Utc};
use gripsou_core::dto::PricePoint;
use rust_decimal::Decimal;

/// `rows` = (unix seconds, close). NaN/inf closes and unrepresentable
/// timestamps are dropped (Yahoo emits gaps as non-finite values).
///
/// Timestamps are snapped to UTC midnight of their own day, and at most one
/// point per day survives (the last, which is the freshest reading for a
/// session still in progress).
///
/// A daily bar arrives stamped at the exchange's open — 07:00 UTC for Paris —
/// but while the market is open Yahoo also emits the in-progress candle stamped
/// at the moment of the request. Stored verbatim those are two rows for one
/// day, and the second one drags `max(ts)` into the middle of the afternoon,
/// which is precisely where a resume-from-the-newest-point fetch must never
/// start. A day is the real resolution of this data, so it is also the right
/// key for it.
pub(crate) fn map_points(rows: &[(i64, f64)], currency: &str) -> Vec<PricePoint> {
    let mut out: Vec<PricePoint> = Vec::with_capacity(rows.len());
    for &(ts, close) in rows {
        let Some(unit_price) = Decimal::from_f64_retain(close).map(|d| d.round_dp(6)) else {
            continue;
        };
        let Some(ts) = DateTime::from_timestamp(ts, 0).map(day_start) else {
            continue;
        };
        // Yahoo emits ascending, so a repeat of the current day is always the
        // immediately preceding entry.
        if out.last().map(|p: &PricePoint| p.ts) == Some(ts) {
            out.pop();
        }
        out.push(PricePoint {
            ts,
            unit_price,
            currency: currency.to_string(),
        });
    }
    out
}

/// UTC midnight of the day `ts` falls in.
fn day_start(ts: DateTime<Utc>) -> DateTime<Utc> {
    ts.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::prelude::ToPrimitive;

    // 2024-06-13 and 2024-06-14, both at 00:00 UTC.
    const DAY1: i64 = 1_718_236_800;
    const DAY2: i64 = 1_718_323_200;

    #[test]
    fn maps_rows_to_points_with_currency() {
        let rows = [(DAY1, 698.1_f64), (DAY2, 701.25)];
        let pts = map_points(&rows, "EUR");

        assert_eq!(pts.len(), 2);
        assert_eq!(pts[0].currency, "EUR");
        assert_eq!(pts[0].ts.timestamp(), DAY1);
        assert_eq!(pts[0].unit_price.to_f64().unwrap(), 698.1);
        assert_eq!(pts[1].unit_price.to_f64().unwrap(), 701.25);
    }

    #[test]
    fn drops_non_finite_closes() {
        let rows = [(DAY1, f64::NAN), (DAY2, 12.0)];
        let pts = map_points(&rows, "USD");
        assert_eq!(pts.len(), 1);
        assert_eq!(pts[0].ts.timestamp(), DAY2);
    }

    /// A bar stamped at the Paris open lands on the day, not on 07:00.
    #[test]
    fn snaps_a_bar_to_utc_midnight_of_its_own_day() {
        let pts = map_points(&[(DAY1 + 7 * 3600, 33.5)], "EUR");
        assert_eq!(pts.len(), 1);
        assert_eq!(pts[0].ts.timestamp(), DAY1);
    }

    /// The settled bar and the in-progress candle are one day, not two — and
    /// the surviving point is the freshest reading.
    #[test]
    fn collapses_the_in_progress_candle_into_its_day() {
        let rows = [
            (DAY1 + 7 * 3600, 34.0),         // settled open-stamped bar
            (DAY1 + 15 * 3600 + 2123, 34.5), // live candle, same day
            (DAY2 + 7 * 3600, 35.0),
        ];
        let pts = map_points(&rows, "EUR");

        assert_eq!(pts.len(), 2, "one point per day");
        assert_eq!(pts[0].ts.timestamp(), DAY1);
        assert_eq!(pts[0].unit_price.to_f64().unwrap(), 34.5);
        assert_eq!(pts[1].ts.timestamp(), DAY2);
    }

    /// A duplicate day must not survive into the batch: `insert_prices`
    /// unnests into one statement, and Postgres refuses to let ON CONFLICT
    /// touch the same row twice.
    #[test]
    fn never_emits_the_same_day_twice() {
        let rows = [
            (DAY1, 1.0),
            (DAY1 + 3600, 2.0),
            (DAY1 + 7200, 3.0),
            (DAY2, 4.0),
        ];
        let pts = map_points(&rows, "EUR");
        let mut days: Vec<i64> = pts.iter().map(|p| p.ts.timestamp()).collect();
        let before = days.len();
        days.dedup();
        assert_eq!(days.len(), before);
        assert_eq!(before, 2);
    }
}
