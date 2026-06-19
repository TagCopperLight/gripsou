//! Map Yahoo daily bars into canonical `PricePoint`s. The f64 → Decimal
//! conversion is the single, deliberate float boundary (Yahoo only emits f64).

use chrono::DateTime;
use gripsou_core::dto::PricePoint;
use rust_decimal::Decimal;

/// `rows` = (unix seconds, close). NaN/inf closes and unrepresentable
/// timestamps are dropped (Yahoo emits gaps as non-finite values).
pub(crate) fn map_points(rows: &[(i64, f64)], currency: &str) -> Vec<PricePoint> {
    rows.iter()
        .filter_map(|&(ts, close)| {
            let unit_price = Decimal::from_f64_retain(close)?.round_dp(6);
            let ts = DateTime::from_timestamp(ts, 0)?;
            Some(PricePoint { ts, unit_price, currency: currency.to_string() })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::prelude::ToPrimitive;

    #[test]
    fn maps_rows_to_points_with_currency() {
        let rows = [(1_718_236_800_i64, 698.1_f64), (1_718_323_200, 701.25)];
        let pts = map_points(&rows, "EUR");

        assert_eq!(pts.len(), 2);
        assert_eq!(pts[0].currency, "EUR");
        assert_eq!(pts[0].ts.timestamp(), 1_718_236_800);
        assert_eq!(pts[0].unit_price.to_f64().unwrap(), 698.1);
        assert_eq!(pts[1].unit_price.to_f64().unwrap(), 701.25);
    }

    #[test]
    fn drops_non_finite_closes() {
        let rows = [(1_718_236_800_i64, f64::NAN), (1_718_323_200, 12.0)];
        let pts = map_points(&rows, "USD");
        assert_eq!(pts.len(), 1);
        assert_eq!(pts[0].ts.timestamp(), 1_718_323_200);
    }
}
