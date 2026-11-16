//! The Overview's arithmetic: pure functions over `DayCategoryRow`s, no database.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::budget::vocab::CategoryKind;

#[derive(Debug, Clone)]
pub struct DayCategoryRow {
    pub day: NaiveDate,
    pub category_id: Option<Uuid>,
    pub category_kind: Option<CategoryKind>,
    /// Rows with no rate on their day are left out (see `fx_missing`).
    pub amount: Decimal,
    pub txn_count: i64,
    /// A row in this bucket had no rate on its day and is left out of `amount`.
    pub fx_missing: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slice {
    Category(Uuid),
    Uncategorised,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SliceAmount {
    pub slice: Slice,
    pub amount: Decimal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Figures {
    pub income: Decimal,
    pub expenses: Decimal,
    pub net: Decimal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sankey {
    pub sources: Vec<SliceAmount>,
    pub destinations: Vec<SliceAmount>,
    /// At most one of `not_spent` and `drawn_from_savings` is `Some`; both are `None` when the remainder is zero.
    pub not_spent: Option<Decimal>,
    pub drawn_from_savings: Option<Decimal>,
}

fn sankey_min_share() -> Decimal {
    Decimal::new(2, 2)
}
const SANKEY_MAX_SLICES: usize = 8;

/// Shared by `figures()` and `side()` so the headline and the diagram agree on which side a category belongs.
fn category_net_amounts(rows: &[DayCategoryRow], kind: CategoryKind) -> Vec<(Uuid, Decimal)> {
    let mut by_category: Vec<(Uuid, Decimal)> = vec![];
    for r in rows.iter().filter(|r| r.category_kind == Some(kind)) {
        let Some(id) = r.category_id else { continue };
        match by_category.iter_mut().find(|(c, _)| *c == id) {
            Some((_, total)) => *total += r.amount,
            None => by_category.push((id, r.amount)),
        }
    }
    by_category
}

/// A category that nets inward contributes nothing, not a negative.
fn net_outflows(rows: &[DayCategoryRow], kind: CategoryKind) -> Vec<(Uuid, Decimal)> {
    category_net_amounts(rows, kind)
        .into_iter()
        .map(|(id, total)| (id, -total))
        .filter(|(_, out)| *out > Decimal::ZERO)
        .collect()
}

fn net_inflows(rows: &[DayCategoryRow], kind: CategoryKind) -> Vec<(Uuid, Decimal)> {
    category_net_amounts(rows, kind)
        .into_iter()
        .filter(|(_, total)| *total > Decimal::ZERO)
        .collect()
}

/// Net is the saving.
pub fn figures(rows: &[DayCategoryRow]) -> Figures {
    let income_categorised: Decimal = net_inflows(rows, CategoryKind::Income)
        .iter()
        .map(|(_, v)| *v)
        .sum();
    let expenses_categorised: Decimal = net_outflows(rows, CategoryKind::Expense)
        .iter()
        .map(|(_, v)| *v)
        .sum();

    // No category to net within, so each row's sign stands in for its kind.
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

    Figures {
        income,
        expenses,
        net: income - expenses,
    }
}

/// Uncategorised rows stay per-row by sign.
fn side(rows: &[DayCategoryRow], want_income_side: bool) -> Vec<SliceAmount> {
    let mut out: Vec<SliceAmount> = if want_income_side {
        net_inflows(rows, CategoryKind::Income)
    } else {
        net_outflows(rows, CategoryKind::Expense)
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

/// Takes no `expenses_total`: a caller-supplied total could disagree with the collapse threshold.
pub fn sankey(rows: &[DayCategoryRow]) -> Sankey {
    let f = figures(rows);
    let sources = collapse(side(rows, true), f.expenses);
    let destinations = collapse(side(rows, false), f.expenses);

    let remainder = f.income - f.expenses;
    let (not_spent, drawn_from_savings) = if remainder > Decimal::ZERO {
        (Some(remainder), None)
    } else if remainder < Decimal::ZERO {
        // The deficit is carried by `drawn_from_savings` alone, never pushed into `sources`: it would add
        // a second `Slice::Other` key when `collapse` already produced one.
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

const BREAKDOWN_KEEP: usize = 7;
/// Below this many months of history no comparison is made.
const MIN_BASELINE_MONTHS: usize = 3;
/// Must cover what `super::summary` fetches: a narrower window would silently average fewer months.
pub(super) const BASELINE_MONTHS: u32 = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Month {
    pub year: i32,
    pub month: u32,
}

impl Month {
    /// Zero-padded only, e.g. `"2026-09"`.
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

fn by_month(rows: &[DayCategoryRow]) -> BTreeMap<Month, Vec<DayCategoryRow>> {
    let mut out: BTreeMap<Month, Vec<DayCategoryRow>> = BTreeMap::new();
    for r in rows {
        out.entry(Month::containing(r.day))
            .or_default()
            .push(r.clone());
    }
    out
}

fn month_rows(buckets: &BTreeMap<Month, Vec<DayCategoryRow>>, m: Month) -> &[DayCategoryRow] {
    buckets.get(&m).map_or(&[], Vec::as_slice)
}

struct MonthSummary {
    figures: Figures,
    expense_side: Vec<SliceAmount>,
}

/// Months with no rows are present and zero: dropping them would raise the average.
struct Baseline {
    months: Vec<MonthSummary>,
}

/// `None` when there is too little history. History counts from the earliest row present, not from the window asked.
fn baseline(buckets: &BTreeMap<Month, Vec<DayCategoryRow>>, selected: Month) -> Option<Baseline> {
    let first_month = *buckets.keys().next()?;
    let months: Vec<MonthSummary> = (1..=BASELINE_MONTHS)
        .rev()
        .map(|back| selected.minus(back))
        // Months before the user had any data at all are not part of the mean.
        .filter(|m| *m >= first_month)
        .map(|m| {
            let rows = month_rows(buckets, m);
            MonthSummary {
                figures: figures(rows),
                expense_side: side(rows, false),
            }
        })
        .collect();

    (months.len() >= MIN_BASELINE_MONTHS).then_some(Baseline { months })
}

fn baseline_figures(b: &Baseline) -> Figures {
    let n = Decimal::from(b.months.len().max(1));
    let sum =
        |f: fn(&Figures) -> Decimal| b.months.iter().map(|m| f(&m.figures)).sum::<Decimal>() / n;
    Figures {
        income: sum(|f| f.income),
        expenses: sum(|f| f.expenses),
        net: sum(|f| f.net),
    }
}

fn baseline_for_slice(b: &Baseline, slice: Slice) -> Decimal {
    let n = Decimal::from(b.months.len().max(1));
    let total: Decimal = b
        .months
        .iter()
        .filter_map(|m| m.expense_side.iter().find(|x| x.slice == slice))
        .map(|x| x.amount)
        .sum();
    total / n
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BreakdownEntry {
    pub slice: Slice,
    pub amount: Decimal,
    pub txn_count: i64,
    /// `None` on `Other` (its membership changes monthly) and with too little history.
    pub avg12: Option<Decimal>,
}

pub fn breakdown(rows: &[DayCategoryRow]) -> Vec<BreakdownEntry> {
    breakdown_against(rows, None)
}

fn breakdown_against(rows: &[DayCategoryRow], baseline: Option<&Baseline>) -> Vec<BreakdownEntry> {
    let amounts = side(rows, false);

    let mut counts: Vec<(Slice, i64)> = vec![];
    for r in rows {
        let slice = match (r.category_kind, r.category_id) {
            (Some(CategoryKind::Expense), Some(id)) => Slice::Category(id),
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
            // Other's membership changes monthly, so it has no comparison.
            avg12: None,
        });
    }
    out
}

/// Same cap as the Sankey, so a category gets the same colour on both.
const TREND_KEEP: usize = SANKEY_MAX_SLICES;
/// Ranking by total alone would let old spikes crowd the anchor month into Other.
const TREND_ANCHOR_KEEP: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrendSeries {
    pub slice: Slice,
    /// Zeros included so the frontend never aligns sparse arrays.
    pub values: Vec<Decimal>,
}

/// The baseline excludes the selected month; the chart includes it as the last bar.
///
/// `fold` is the user's catch-all category, always rolled into `Other` so the legend never shows two.
pub fn trend(rows: &[DayCategoryRow], anchor: Month, months: u32, fold: Option<Uuid>) -> Trend {
    let axis: Vec<Month> = (0..months).rev().map(|back| anchor.minus(back)).collect();

    let buckets = by_month(rows);
    let per_month: Vec<Vec<SliceAmount>> = axis
        .iter()
        .map(|m| side(month_rows(&buckets, *m), false))
        .collect();
    let foldable = |s: Slice| fold.is_some_and(|id| s == Slice::Category(id));

    // Ranked by window total so a stack's composition is the same in every bar.
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

    // The anchor month's largest first, then the window's largest: one set for the whole window.
    let anchor_top = per_month
        .last()
        .into_iter()
        .flatten()
        .map(|x| x.slice)
        .filter(|s| !foldable(*s))
        .take(TREND_ANCHOR_KEEP);
    let by_total = totals.iter().map(|(s, _)| *s).filter(|s| !foldable(*s));
    let mut kept: Vec<Slice> = vec![];
    for slice in anchor_top.chain(by_total) {
        if kept.len() == TREND_KEEP {
            break;
        }
        if !kept.contains(&slice) {
            kept.push(slice);
        }
    }
    // Stacked in window-total order.
    kept.sort_by_key(|s| totals.iter().position(|(t, _)| t == s));

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

    Trend {
        months: axis,
        series,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trend {
    pub months: Vec<Month>,
    pub series: Vec<TrendSeries>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    Month(Month),
    /// Never compared: a range that runs 1-30 September is not "September".
    Range {
        from: NaiveDate,
        to: NaiveDate,
    },
}

impl Period {
    pub fn bounds(&self) -> (NaiveDate, NaiveDate) {
        match *self {
            Period::Month(m) => m.bounds(),
            Period::Range { from, to } => (from, to),
        }
    }

    pub(super) fn window(&self) -> (NaiveDate, NaiveDate) {
        let (from, to) = self.bounds();
        match *self {
            Period::Month(m) => (m.minus(BASELINE_MONTHS).bounds().0, to),
            Period::Range { .. } => (from, to),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Comparison {
    pub prev_month: Figures,
    pub avg12: Figures,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    /// Paired transfers, neutral rows and lots are not counted.
    pub txn_count: i64,
    pub fx_missing: bool,
    pub figures: Figures,
    pub comparison: Option<Comparison>,
    pub sankey: Sankey,
    pub breakdown: Vec<BreakdownEntry>,
}

pub fn summarise(window: &[DayCategoryRow], period: Period) -> Summary {
    let (period_rows, comparison, base) = match period {
        Period::Month(m) => {
            let buckets = by_month(window);
            let base = baseline(&buckets, m);
            let comparison = base.as_ref().map(|b| Comparison {
                prev_month: figures(month_rows(&buckets, m.minus(1))),
                avg12: baseline_figures(b),
            });
            (month_rows(&buckets, m).to_vec(), comparison, base)
        }
        Period::Range { from, to } => (
            window
                .iter()
                .filter(|r| r.day >= from && r.day <= to)
                .cloned()
                .collect(),
            None,
            None,
        ),
    };
    Summary {
        txn_count: period_rows.iter().map(|r| r.txn_count).sum(),
        fx_missing: period_rows.iter().any(|r| r.fx_missing),
        figures: figures(&period_rows),
        comparison,
        sankey: sankey(&period_rows),
        breakdown: breakdown_against(&period_rows, base.as_ref()),
    }
}
