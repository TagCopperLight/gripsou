//! Money-weighted annualised return (XIRR) of the invested part of a user's
//! holdings. Pure: the loader in `repo::returns` gathers the inputs.

use chrono::NaiveDate;

/// One dated amount, negative when money goes in (a buy), positive when it
/// comes out (a sale, a dividend, today's value). In the reporting currency.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Flow {
    pub day: NaiveDate,
    pub amount: f64,
}

/// The yearly rate `r` with `Σ amount · (1 + r)^(−days / 365) = 0`, counting
/// days from the first flow. `None` when there is nothing to solve: no flows,
/// all on one day, or no sign change over the search range (only money in, or
/// a gain too extreme to annualise).
///
/// Bisection rather than Newton: the net present value of an investment's
/// flows falls as the rate rises, so a bracketed root is always found, with no
/// starting guess to get wrong.
pub fn xirr(flows: &[Flow]) -> Option<f64> {
    let first = flows.iter().map(|f| f.day).min()?;
    let last = flows.iter().map(|f| f.day).max()?;
    if first == last {
        return None;
    }
    let npv = |r: f64| -> f64 {
        flows
            .iter()
            .map(|f| f.amount / (1.0 + r).powf((f.day - first).num_days() as f64 / 365.0))
            .sum()
    };
    // Just above a total loss, up to a billion-fold gain a year.
    let (mut lo, mut hi) = (-0.9999_f64, 1.0e9_f64);
    let at_lo = npv(lo);
    let at_hi = npv(hi);
    if !at_lo.is_finite() || !at_hi.is_finite() || at_lo == 0.0 || at_hi == 0.0 {
        return None;
    }
    if at_lo.signum() == at_hi.signum() {
        return None;
    }
    for _ in 0..300 {
        let mid = lo + (hi - lo) / 2.0;
        let at_mid = npv(mid);
        if at_mid == 0.0 {
            return Some(mid);
        }
        if at_mid.signum() == at_lo.signum() {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Some(lo + (hi - lo) / 2.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    fn f(day: &str, amount: f64) -> Flow {
        Flow {
            day: d(day),
            amount,
        }
    }

    #[test]
    fn one_year_ten_percent() {
        let r = xirr(&[f("2025-01-01", -1000.0), f("2026-01-01", 1100.0)]).unwrap();
        assert!((r - 0.10).abs() < 1e-6, "{r}");
    }

    #[test]
    fn two_deposits_compound() {
        // 1000 grows two years, 1000 one year, both at 10 %: 1210 + 1100.
        let r = xirr(&[
            f("2024-01-01", -1000.0),
            f("2024-12-31", -1000.0),
            f("2025-12-31", 2310.0),
        ])
        .unwrap();
        assert!((r - 0.10).abs() < 1e-3, "{r}");
    }

    #[test]
    fn a_loss_is_negative() {
        let r = xirr(&[f("2025-01-01", -1000.0), f("2026-01-01", 900.0)]).unwrap();
        assert!((r + 0.10).abs() < 1e-6, "{r}");
    }

    #[test]
    fn short_periods_are_annualised() {
        // +1 % in ~3 months is ~4 % a year.
        let r = xirr(&[f("2026-01-01", -1000.0), f("2026-04-02", 1010.0)]).unwrap();
        assert!(r > 0.039 && r < 0.042, "{r}");
    }

    #[test]
    fn nothing_to_solve() {
        assert_eq!(xirr(&[]), None);
        assert_eq!(
            xirr(&[f("2026-01-01", -1000.0), f("2026-01-01", 1000.0)]),
            None
        );
        assert_eq!(
            xirr(&[f("2025-01-01", -1000.0), f("2026-01-01", -10.0)]),
            None
        );
    }
}
