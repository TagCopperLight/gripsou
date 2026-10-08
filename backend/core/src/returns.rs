//! Money-weighted annualised return (XIRR) of the invested part of a user's
//! holdings. Pure: the loader in `repo::returns` gathers the inputs.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use uuid::Uuid;

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

/// One non-cash holding in scope. `value`/`invested` are the Holdings table's
/// figures (reporting currency); a sold-out holding has both at zero.
#[derive(Debug, Clone, PartialEq)]
pub struct Position {
    pub holding_id: Uuid,
    pub account_id: Uuid,
    pub name: String,
    /// The recorded lots explain the quantity held (buys − sells = quantity).
    pub complete: bool,
    pub value: Decimal,
    pub invested: Decimal,
}

/// A lot (`holding_id` set) or a dividend (`holding_id` none — transactions
/// carry no instrument, so dividends belong to the account), signed like
/// `Flow`, converted to the reporting currency on its own day. `amount` is
/// `None` when that day's rate is missing.
#[derive(Debug, Clone, PartialEq)]
pub struct CashFlow {
    pub holding_id: Option<Uuid>,
    pub account_id: Uuid,
    pub day: NaiveDate,
    pub amount: Option<Decimal>,
}

/// A holding left out of the return because its purchases aren't recorded.
#[derive(Debug, Clone, PartialEq)]
pub struct Missing {
    pub holding_id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScopeReturn {
    /// Per year, as a ratio (0.071 = +7.1 %/yr).
    pub annualised: Option<f64>,
    /// First purchase the return covers.
    pub since: Option<NaiveDate>,
    pub invested: Decimal,
    pub value: Decimal,
    pub missing: Vec<Missing>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AccountReturn {
    pub account_id: Uuid,
    pub figures: ScopeReturn,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Returns {
    pub total: ScopeReturn,
    /// Accounts with at least one position, largest value first.
    pub accounts: Vec<AccountReturn>,
}

/// The figures of one scope (an account, or everything).
///
/// Invested and value cover every position. The return covers the complete
/// ones only: their lots, the dividends of accounts that have at least one
/// complete position, and today their current value. Any missing rate among
/// those flows leaves the return unknown rather than wrong.
pub fn scope_return(positions: &[&Position], flows: &[&CashFlow], today: NaiveDate) -> ScopeReturn {
    let invested = positions.iter().map(|p| p.invested).sum();
    let value = positions.iter().map(|p| p.value).sum();
    let mut missing: Vec<Missing> = positions
        .iter()
        .filter(|p| !p.complete)
        .map(|p| Missing {
            holding_id: p.holding_id,
            name: p.name.clone(),
        })
        .collect();
    missing.sort_by(|a, b| a.name.cmp(&b.name));

    let complete: Vec<&&Position> = positions.iter().filter(|p| p.complete).collect();
    let counts = |f: &CashFlow| match f.holding_id {
        Some(h) => complete.iter().any(|p| p.holding_id == h),
        None => complete.iter().any(|p| p.account_id == f.account_id),
    };
    let included: Vec<&&CashFlow> = flows.iter().filter(|f| counts(f)).collect();
    let since = included
        .iter()
        .filter(|f| f.holding_id.is_some())
        .map(|f| f.day)
        .min();

    let annualised = since.and_then(|_| {
        let mut solved: Vec<Flow> = Vec::with_capacity(included.len() + 1);
        for f in &included {
            solved.push(Flow {
                day: f.day,
                amount: f.amount?.to_f64()?,
            });
        }
        let held: Decimal = complete.iter().map(|p| p.value).sum();
        solved.push(Flow {
            day: today,
            amount: held.to_f64()?,
        });
        xirr(&solved)
    });

    ScopeReturn {
        annualised,
        since,
        invested,
        value,
        missing,
    }
}

/// The total and one figure per account.
pub fn returns(positions: &[Position], flows: &[CashFlow], today: NaiveDate) -> Returns {
    let all_positions: Vec<&Position> = positions.iter().collect();
    let all_flows: Vec<&CashFlow> = flows.iter().collect();
    let total = scope_return(&all_positions, &all_flows, today);

    let mut account_ids: Vec<Uuid> = Vec::new();
    for p in positions {
        if !account_ids.contains(&p.account_id) {
            account_ids.push(p.account_id);
        }
    }
    let mut accounts: Vec<AccountReturn> = account_ids
        .into_iter()
        .map(|id| {
            let ps: Vec<&Position> = positions.iter().filter(|p| p.account_id == id).collect();
            let fs: Vec<&CashFlow> = flows.iter().filter(|f| f.account_id == id).collect();
            AccountReturn {
                account_id: id,
                figures: scope_return(&ps, &fs, today),
            }
        })
        .collect();
    accounts.sort_by_key(|a| std::cmp::Reverse(a.figures.value));

    Returns { total, accounts }
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

    fn dec(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    fn pos(holding: u128, account: u128, complete: bool, value: &str, invested: &str) -> Position {
        Position {
            holding_id: Uuid::from_u128(holding),
            account_id: Uuid::from_u128(account),
            name: format!("H{holding}"),
            complete,
            value: dec(value),
            invested: dec(invested),
        }
    }

    fn lot(holding: u128, account: u128, day: &str, amount: &str) -> CashFlow {
        CashFlow {
            holding_id: Some(Uuid::from_u128(holding)),
            account_id: Uuid::from_u128(account),
            day: d(day),
            amount: Some(dec(amount)),
        }
    }

    fn dividend(account: u128, day: &str, amount: &str) -> CashFlow {
        CashFlow {
            holding_id: None,
            ..lot(0, account, day, amount)
        }
    }

    fn all<T>(v: &[T]) -> Vec<&T> {
        v.iter().collect()
    }

    #[test]
    fn complete_position_gives_its_return() {
        let p = [pos(1, 10, true, "1100", "1000")];
        let fl = [lot(1, 10, "2025-01-01", "-1000")];
        let s = scope_return(&all(&p), &all(&fl), d("2026-01-01"));
        assert!((s.annualised.unwrap() - 0.10).abs() < 1e-6);
        assert_eq!(s.since, Some(d("2025-01-01")));
        assert_eq!((s.invested, s.value), (dec("1000"), dec("1100")));
        assert!(s.missing.is_empty());
    }

    #[test]
    fn incomplete_position_counts_in_figures_not_in_return() {
        let p = [
            pos(1, 10, true, "1100", "1000"),
            pos(2, 10, false, "500", "400"),
        ];
        let fl = [
            lot(1, 10, "2025-01-01", "-1000"),
            lot(2, 10, "2025-06-01", "-100"),
        ];
        let s = scope_return(&all(&p), &all(&fl), d("2026-01-01"));
        assert!((s.annualised.unwrap() - 0.10).abs() < 1e-6);
        assert_eq!((s.invested, s.value), (dec("1400"), dec("1600")));
        assert_eq!(
            s.missing,
            vec![Missing {
                holding_id: Uuid::from_u128(2),
                name: "H2".into()
            }]
        );
    }

    #[test]
    fn dividends_count_at_account_level() {
        // 1000 in; 50 paid out and 1050 held after a year: 1100 back, 10 %.
        let p = [pos(1, 10, true, "1050", "1000")];
        let fl = [
            lot(1, 10, "2025-01-01", "-1000"),
            dividend(10, "2026-01-01", "50"),
        ];
        let s = scope_return(&all(&p), &all(&fl), d("2026-01-01"));
        assert!((s.annualised.unwrap() - 0.10).abs() < 1e-6);
    }

    #[test]
    fn dividends_of_an_account_with_nothing_complete_are_ignored() {
        let p = [
            pos(1, 10, true, "1100", "1000"),
            pos(2, 20, false, "500", "500"),
        ];
        let fl = [
            lot(1, 10, "2025-01-01", "-1000"),
            dividend(20, "2025-06-01", "999"),
        ];
        let s = scope_return(&all(&p), &all(&fl), d("2026-01-01"));
        assert!((s.annualised.unwrap() - 0.10).abs() < 1e-6);
    }

    #[test]
    fn a_missing_rate_leaves_the_return_unknown() {
        let p = [pos(1, 10, true, "1100", "1000")];
        let mut fl = [lot(1, 10, "2025-01-01", "-1000")];
        fl[0].amount = None;
        let s = scope_return(&all(&p), &all(&fl), d("2026-01-01"));
        assert_eq!(s.annualised, None);
        assert_eq!(s.since, Some(d("2025-01-01")));
    }

    #[test]
    fn nothing_complete_means_no_return() {
        let p = [pos(1, 10, false, "500", "500")];
        let fl = [lot(1, 10, "2025-01-01", "-500")];
        let s = scope_return(&all(&p), &all(&fl), d("2026-01-01"));
        assert_eq!((s.annualised, s.since), (None, None));
    }

    #[test]
    fn sold_out_position_contributes_its_flows() {
        // Bought 1000, sold 1100 a year later, nothing held: 10 %.
        let p = [pos(1, 10, true, "0", "0")];
        let fl = [
            lot(1, 10, "2025-01-01", "-1000"),
            lot(1, 10, "2026-01-01", "1100"),
        ];
        let s = scope_return(&all(&p), &all(&fl), d("2026-01-01"));
        assert!((s.annualised.unwrap() - 0.10).abs() < 1e-6);
    }

    #[test]
    fn returns_splits_by_account_largest_first() {
        let p = [
            pos(1, 10, true, "100", "90"),
            pos(2, 20, true, "1100", "1000"),
        ];
        let fl = [
            lot(1, 10, "2025-01-01", "-90"),
            lot(2, 20, "2025-01-01", "-1000"),
        ];
        let r = returns(&p, &fl, d("2026-01-01"));
        let ids: Vec<_> = r.accounts.iter().map(|a| a.account_id).collect();
        assert_eq!(ids, vec![Uuid::from_u128(20), Uuid::from_u128(10)]);
        assert_eq!(r.total.value, dec("1200"));
        assert!(r.total.annualised.is_some());
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
