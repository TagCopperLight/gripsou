//! The Overview's arithmetic: pure functions over `DayCategoryRow`s, with no
//! database and no `sqlx`. Everything interesting about the Overview lives
//! here — the Sankey's balancing, the collapse rules, the baselines — which is
//! what makes it testable without a Postgres.

use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::repo::budget::summary::DayCategoryRow;

/// What a Sankey node, a breakdown row and a trend series all are. One union
/// so the frontend's category chip has a single input shape everywhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slice {
    Category(Uuid),
    /// The amber chip: rows with no category at all.
    Uncategorised,
    /// The rollup of everything below the collapse threshold.
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SliceAmount {
    pub slice: Slice,
    /// Always positive — direction is carried by which list it is in.
    pub amount: Decimal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Figures {
    pub income: Decimal,
    /// Positive. Expenses are reported as a magnitude, not as a negative.
    pub expenses: Decimal,
    pub net: Decimal,
    pub saved: Decimal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sankey {
    pub sources: Vec<SliceAmount>,
    pub destinations: Vec<SliceAmount>,
    /// `Income - Expenses - Saved`, when that is positive. At most one of
    /// `not_spent` and `drawn_from_savings` is ever `Some` — both are `None`
    /// when the remainder is exactly zero, so "mutually exclusive" would
    /// overstate it.
    pub not_spent: Option<Decimal>,
    pub drawn_from_savings: Option<Decimal>,
}

/// A side keeps slices at or above this share of the period's expenses (2%).
/// A function rather than a `const` because `Decimal` construction is not
/// const here — the same reason `default_review_threshold()` is one.
fn sankey_min_share() -> Decimal {
    Decimal::new(2, 2)
}
/// ...and never shows more than this many, Other excluded.
const SANKEY_MAX_SLICES: usize = 8;

/// Per-category net raw amount, restricted to rows of one `category_kind`.
/// Shared by `figures()` and `side()` so a category whose refunds exceed its
/// spending (or vice versa) cannot make the headline figure and the diagram
/// disagree about which side it belongs on — both read the same net.
fn category_net_amounts(rows: &[DayCategoryRow], kind: &str) -> Vec<(Uuid, Decimal)> {
    let mut by_category: Vec<(Uuid, Decimal)> = vec![];
    for r in rows
        .iter()
        .filter(|r| r.category_kind.as_deref() == Some(kind))
    {
        let Some(id) = r.category_id else { continue };
        match by_category.iter_mut().find(|(c, _)| *c == id) {
            Some((_, total)) => *total += r.amount,
            None => by_category.push((id, r.amount)),
        }
    }
    by_category
}

/// Categories of `kind` that net outward (money left), as positive
/// magnitudes. A category that nets inward contributes nothing rather than a
/// negative: a month where savings were drawn down is not a month of
/// negative saving, and a category whose refunds outran its spending is not
/// negative spending — it is simply not represented on this side.
fn net_outflows(rows: &[DayCategoryRow], kind: &str) -> Vec<(Uuid, Decimal)> {
    category_net_amounts(rows, kind)
        .into_iter()
        .map(|(id, total)| (id, -total))
        .filter(|(_, out)| *out > Decimal::ZERO)
        .collect()
}

/// Categories of `kind` that net inward (money arrived), as positive
/// magnitudes. The inward counterpart of `net_outflows`.
fn net_inflows(rows: &[DayCategoryRow], kind: &str) -> Vec<(Uuid, Decimal)> {
    category_net_amounts(rows, kind)
        .into_iter()
        .filter(|(_, total)| *total > Decimal::ZERO)
        .collect()
}

/// The four headline numbers (spec 4.1).
pub fn figures(rows: &[DayCategoryRow]) -> Figures {
    let income_categorised: Decimal = net_inflows(rows, "income").iter().map(|(_, v)| *v).sum();
    let expenses_categorised: Decimal = net_outflows(rows, "expense").iter().map(|(_, v)| *v).sum();

    // No category to net within, so the sign of each row stands in for its
    // kind (spec 2.2). Without this a freshly synced Overview shows
    // near-zero everything and reads as a broken page.
    let mut income_uncategorised = Decimal::ZERO;
    let mut expenses_uncategorised = Decimal::ZERO;
    for r in rows.iter().filter(|r| r.category_kind.is_none()) {
        if r.amount > Decimal::ZERO {
            income_uncategorised += r.amount;
        } else {
            expenses_uncategorised += -r.amount;
        }
    }

    let income = income_categorised + income_uncategorised;
    let expenses = expenses_categorised + expenses_uncategorised;
    let saved = net_outflows(rows, "internal").iter().map(|(_, v)| *v).sum();

    Figures {
        income,
        expenses,
        net: income - expenses,
        saved,
    }
}

/// One side of the Sankey: categorised slices net per category (same rule as
/// `figures()`), uncategorised rows stay per-row by sign. Positive
/// magnitudes, sorted largest first.
fn side(rows: &[DayCategoryRow], want_income_side: bool) -> Vec<SliceAmount> {
    let mut out: Vec<SliceAmount> = if want_income_side {
        net_inflows(rows, "income")
    } else {
        net_outflows(rows, "expense")
    }
    .into_iter()
    .map(|(id, amount)| SliceAmount {
        slice: Slice::Category(id),
        amount,
    })
    .collect();

    let mut uncategorised = Decimal::ZERO;
    for r in rows.iter().filter(|r| r.category_kind.is_none()) {
        let is_inflow = r.amount > Decimal::ZERO;
        if is_inflow != want_income_side {
            continue;
        }
        uncategorised += if is_inflow { r.amount } else { -r.amount };
    }
    out.push(SliceAmount {
        slice: Slice::Uncategorised,
        amount: uncategorised,
    });

    out.retain(|x| x.amount > Decimal::ZERO);
    out.sort_by_key(|x| std::cmp::Reverse(x.amount));
    out
}

/// Roll everything below the threshold, or beyond the cap, into one `Other`.
fn collapse(mut slices: Vec<SliceAmount>, expenses_total: Decimal) -> Vec<SliceAmount> {
    let floor = expenses_total * sankey_min_share();
    let keep = slices
        .iter()
        .take(SANKEY_MAX_SLICES)
        .take_while(|x| x.amount >= floor)
        .count();
    if keep == slices.len() {
        return slices;
    }
    let rest: Decimal = slices[keep..].iter().map(|x| x.amount).sum();
    slices.truncate(keep);
    if rest > Decimal::ZERO {
        slices.push(SliceAmount {
            slice: Slice::Other,
            amount: rest,
        });
    }
    slices
}

/// Insert `internal` branches before the trailing `Other`, if any, so `Other`
/// stays the last entry on the side. Internal branches are exempt from the
/// 2%/8 cap: the spec promises one branch per net-outflow `internal`
/// category, and rolling savings into "Other" would hide the destination a
/// reader most wants to see.
fn insert_before_trailing_other(
    mut slices: Vec<SliceAmount>,
    extra: Vec<SliceAmount>,
) -> Vec<SliceAmount> {
    let other = match slices.last() {
        Some(x) if x.slice == Slice::Other => slices.pop(),
        _ => None,
    };
    slices.extend(extra);
    if let Some(other) = other {
        slices.push(other);
    }
    slices
}

/// The diagram (spec 4.2). No `expenses_total` parameter — `sankey()` already
/// computes `figures(rows)` internally for the balancing remainder, and a
/// caller-supplied total would be the only way the collapse threshold and the
/// headline figure could ever disagree.
pub fn sankey(rows: &[DayCategoryRow]) -> Sankey {
    let f = figures(rows);
    let sources = collapse(side(rows, true), f.expenses);
    let destinations = collapse(side(rows, false), f.expenses);

    // Internal categories are drawn net, one branch each. A fully paired
    // transfer nets to zero and disappears on its own — no special case.
    let mut internal = net_outflows(rows, "internal")
        .into_iter()
        .map(|(id, amount)| SliceAmount {
            slice: Slice::Category(id),
            amount,
        })
        .collect::<Vec<_>>();
    internal.sort_by_key(|x| std::cmp::Reverse(x.amount));
    let destinations = insert_before_trailing_other(destinations, internal);

    let remainder = f.income - f.expenses - f.saved;
    let (not_spent, drawn_from_savings) = if remainder > Decimal::ZERO {
        (Some(remainder), None)
    } else if remainder < Decimal::ZERO {
        // The deficit is carried by `drawn_from_savings` alone — it is never
        // pushed into `sources`, the mirror of `not_spent` never being pushed
        // into `destinations`. Pushing it created a second `Slice::Other` key
        // on the source side whenever `collapse` had already produced one.
        (None, Some(-remainder))
    } else {
        (None, None)
    };

    Sankey {
        sources,
        destinations,
        not_spent,
        drawn_from_savings,
    }
}

/// The breakdown keeps this many rows before rolling up (UI-design 1.5).
const BREAKDOWN_KEEP: usize = 7;
/// Below this many months of history a comparison is noise dressed as a
/// number, so it is omitted entirely (spec 4.4).
const MIN_BASELINE_MONTHS: usize = 3;
/// How far back `baseline()` walks, and — via `api::budget::summary`'s use
/// of this same constant — how wide `/api/budget/summary` fetches to cover
/// it. One constant so the two can never drift: a fetch window narrower than
/// the walk would make `baseline()` silently average over fewer months
/// instead of failing loudly.
pub const BASELINE_MONTHS: u32 = 12;

/// A calendar month. The Overview's period when it is not a custom range.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Month {
    pub year: i32,
    pub month: u32,
}

impl Month {
    /// `"2026-09"`. Zero-padded only — the frontend always sends that form, and
    /// accepting `"2026-9"` too would mean two spellings of one month.
    pub fn parse(s: &str) -> Option<Month> {
        let (y, m) = s.split_once('-')?;
        if y.len() != 4 || m.len() != 2 {
            return None;
        }
        let month: u32 = m.parse().ok()?;
        if !(1..=12).contains(&month) {
            return None;
        }
        Some(Month {
            year: y.parse().ok()?,
            month,
        })
    }

    pub fn label(&self) -> String {
        format!("{:04}-{:02}", self.year, self.month)
    }

    /// First and last day, inclusive. Day 1 of the next month minus one day —
    /// which is right in February and in a leap year without a table.
    pub fn bounds(&self) -> (NaiveDate, NaiveDate) {
        let first = NaiveDate::from_ymd_opt(self.year, self.month, 1).expect("valid month");
        let next = self.next();
        let last = NaiveDate::from_ymd_opt(next.year, next.month, 1)
            .expect("valid month")
            .pred_opt()
            .expect("not the epoch");
        (first, last)
    }

    fn next(&self) -> Month {
        match self.month {
            12 => Month {
                year: self.year + 1,
                month: 1,
            },
            m => Month {
                year: self.year,
                month: m + 1,
            },
        }
    }

    pub fn prev(&self) -> Month {
        self.minus(1)
    }

    pub fn minus(&self, months: u32) -> Month {
        let total = self.year * 12 + self.month as i32 - 1 - months as i32;
        Month {
            year: total.div_euclid(12),
            month: total.rem_euclid(12) as u32 + 1,
        }
    }

    pub fn containing(day: NaiveDate) -> Month {
        Month {
            year: day.year(),
            month: day.month(),
        }
    }
}

/// The rows falling in `[from, to]`, both edges included.
pub fn rows_in(rows: &[DayCategoryRow], from: NaiveDate, to: NaiveDate) -> Vec<&DayCategoryRow> {
    rows.iter()
        .filter(|r| r.day >= from && r.day <= to)
        .collect()
}

/// The twelve complete months before the selected one, each with its rows.
/// Months with no rows are present and empty — dropping them would let a quiet
/// month silently raise the average.
pub struct Baseline {
    pub months: Vec<(Month, Vec<DayCategoryRow>)>,
}

/// `None` when there is too little history to compare against (spec 4.4).
///
/// "History" is counted from the earliest row present, not from the window
/// asked for: a user who connected a bank last month has one month of history
/// no matter how wide a window the caller fetched.
pub fn baseline(rows: &[DayCategoryRow], selected: Month) -> Option<Baseline> {
    let earliest = rows.iter().map(|r| r.day).min()?;
    let first_month = Month::containing(earliest);

    let mut months = vec![];
    for back in (1..=BASELINE_MONTHS).rev() {
        let m = selected.minus(back);
        // Months before the user had any data at all are not part of the mean.
        if (m.year, m.month) < (first_month.year, first_month.month) {
            continue;
        }
        let (from, to) = m.bounds();
        months.push((m, rows_in(rows, from, to).into_iter().cloned().collect()));
    }

    (months.len() >= MIN_BASELINE_MONTHS).then_some(Baseline { months })
}

/// The mean month of the baseline, as the same four figures.
pub fn baseline_figures(b: &Baseline) -> Figures {
    let n = Decimal::from(b.months.len().max(1));
    let each: Vec<Figures> = b.months.iter().map(|(_, rows)| figures(rows)).collect();
    let sum = |f: fn(&Figures) -> Decimal| each.iter().map(f).sum::<Decimal>() / n;
    Figures {
        income: sum(|f| f.income),
        expenses: sum(|f| f.expenses),
        net: sum(|f| f.net),
        saved: sum(|f| f.saved),
    }
}

/// The mean monthly amount for one slice across the baseline.
fn baseline_for_slice(b: &Baseline, slice: Slice) -> Decimal {
    let n = Decimal::from(b.months.len().max(1));
    let total: Decimal = b
        .months
        .iter()
        .map(|(_, rows)| {
            expense_side_amounts(rows)
                .into_iter()
                .find(|x| x.slice == slice)
                .map(|x| x.amount)
                .unwrap_or(Decimal::ZERO)
        })
        .sum();
    total / n
}

/// Expense-kind categories and uncategorised outflows, as positive magnitudes,
/// largest first. The breakdown's raw material, before collapsing.
fn expense_side_amounts(rows: &[DayCategoryRow]) -> Vec<SliceAmount> {
    side(rows, false)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BreakdownEntry {
    pub slice: Slice,
    /// Positive.
    pub amount: Decimal,
    pub txn_count: i64,
    /// `None` on the `Other` row, whose membership changes month to month, and
    /// whenever there is too little history (spec 4.4).
    pub avg12: Option<Decimal>,
}

/// The breakdown table (spec 2.3, 4.3): expense-side only, the 7 largest by
/// magnitude plus an `Other` rollup.
pub fn breakdown(rows: &[DayCategoryRow], baseline: Option<&Baseline>) -> Vec<BreakdownEntry> {
    let amounts = expense_side_amounts(rows);

    let mut counts: Vec<(Slice, i64)> = vec![];
    for r in rows {
        let slice = match (r.category_kind.as_deref(), r.category_id) {
            (Some("expense"), Some(id)) => Slice::Category(id),
            (None, _) if r.amount < Decimal::ZERO => Slice::Uncategorised,
            _ => continue,
        };
        match counts.iter_mut().find(|(s, _)| *s == slice) {
            Some((_, n)) => *n += r.txn_count,
            None => counts.push((slice, r.txn_count)),
        }
    }
    let count_of = |slice: Slice| {
        counts
            .iter()
            .find(|(s, _)| *s == slice)
            .map(|(_, n)| *n)
            .unwrap_or(0)
    };

    let keep = amounts.len().min(BREAKDOWN_KEEP);
    let mut out: Vec<BreakdownEntry> = amounts[..keep]
        .iter()
        .map(|x| BreakdownEntry {
            slice: x.slice,
            amount: x.amount,
            txn_count: count_of(x.slice),
            avg12: baseline.map(|b| baseline_for_slice(b, x.slice)),
        })
        .collect();

    if amounts.len() > keep {
        let rest: Decimal = amounts[keep..].iter().map(|x| x.amount).sum();
        let rest_count: i64 = amounts[keep..].iter().map(|x| count_of(x.slice)).sum();
        out.push(BreakdownEntry {
            slice: Slice::Other,
            amount: rest,
            txn_count: rest_count,
            // Other's membership changes month to month, so a comparison
            // against its own past would compare two different sets.
            avg12: None,
        });
    }
    out
}

/// The trend chart keeps this many categories, Other excluded (UI-design 1.6).
const TREND_KEEP: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrendSeries {
    pub slice: Slice,
    /// One value per month, zeros included, so the frontend never aligns
    /// sparse arrays. Positive magnitudes.
    pub values: Vec<Decimal>,
}

/// `months` bars ending at and including `anchor` (UI-design 1.6). The
/// baseline excludes the selected month; the chart includes it as its last bar,
/// because a chart of recent history that stopped before the month you are
/// looking at would be strange to read.
pub fn trend(
    rows: &[DayCategoryRow],
    anchor: Month,
    months: u32,
) -> (Vec<Month>, Vec<TrendSeries>) {
    let axis: Vec<Month> = (0..months).rev().map(|back| anchor.minus(back)).collect();

    let per_month: Vec<Vec<SliceAmount>> = axis
        .iter()
        .map(|m| {
            let (from, to) = m.bounds();
            let slice_rows: Vec<DayCategoryRow> =
                rows_in(rows, from, to).into_iter().cloned().collect();
            expense_side_amounts(&slice_rows)
        })
        .collect();

    // Ranked by total across the window, not by any single month, so a stack's
    // composition is the same in every bar.
    let mut totals: Vec<(Slice, Decimal)> = vec![];
    for month in &per_month {
        for x in month {
            match totals.iter_mut().find(|(s, _)| *s == x.slice) {
                Some((_, t)) => *t += x.amount,
                None => totals.push((x.slice, x.amount)),
            }
        }
    }
    totals.sort_by_key(|(_, total)| std::cmp::Reverse(*total));

    let kept: Vec<Slice> = totals.iter().take(TREND_KEEP).map(|(s, _)| *s).collect();
    let amount_of = |month: &[SliceAmount], slice: Slice| {
        month
            .iter()
            .find(|x| x.slice == slice)
            .map(|x| x.amount)
            .unwrap_or(Decimal::ZERO)
    };

    let mut series: Vec<TrendSeries> = kept
        .iter()
        .map(|slice| TrendSeries {
            slice: *slice,
            values: per_month.iter().map(|m| amount_of(m, *slice)).collect(),
        })
        .collect();

    if totals.len() > kept.len() {
        series.push(TrendSeries {
            slice: Slice::Other,
            values: per_month
                .iter()
                .map(|m| {
                    m.iter()
                        .filter(|x| !kept.contains(&x.slice))
                        .map(|x| x.amount)
                        .sum()
                })
                .collect(),
        });
    }

    (axis, series)
}
