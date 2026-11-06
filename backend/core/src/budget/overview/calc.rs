//! The Overview's arithmetic: pure functions over `DayCategoryRow`s, with no
//! database. Everything interesting about the Overview lives here — the
//! Sankey's balancing, the collapse rules, the baselines — which is what makes
//! it testable without a Postgres.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::budget::vocab::CategoryKind;

/// One (day, category) bucket, already in the reader's reporting currency.
#[derive(Debug, Clone)]
pub struct DayCategoryRow {
    pub day: NaiveDate,
    /// `None` is the Uncategorised slice — on day one, most of them.
    pub category_id: Option<Uuid>,
    /// Never neutral: those rows are dropped by the query. `None` when
    /// `category_id` is.
    pub category_kind: Option<CategoryKind>,
    /// Signed, in the reporting currency, converted at `day`'s rates. A row
    /// with no rate on its day is left out — see `fx_missing`.
    pub amount: Decimal,
    pub txn_count: i64,
    /// At least one row in this bucket had no rate on its day, for its
    /// account's currency or the reader's, and is left out of `amount`.
    pub fx_missing: bool,
}

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sankey {
    pub sources: Vec<SliceAmount>,
    pub destinations: Vec<SliceAmount>,
    /// `Income - Expenses`, when that is positive. At most one of
    /// `not_spent` and `drawn_from_savings` is ever `Some` — both are `None`
    /// when the remainder is exactly zero, so "mutually exclusive" would
    /// overstate it.
    pub not_spent: Option<Decimal>,
    pub drawn_from_savings: Option<Decimal>,
}

/// A side keeps slices at or above this share of the period's expenses (2%).
fn sankey_min_share() -> Decimal {
    Decimal::new(2, 2)
}
/// ...and never shows more than this many, Other excluded.
const SANKEY_MAX_SLICES: usize = 8;

/// Per-category net raw amount, restricted to rows of one `category_kind`.
/// Shared by `figures()` and `side()` so a category whose refunds exceed its
/// spending (or vice versa) cannot make the headline figure and the diagram
/// disagree about which side it belongs on — both read the same net.
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

/// Categories of `kind` that net outward (money left), as positive
/// magnitudes. A category that nets inward contributes nothing rather than a
/// negative: a month where savings were drawn down is not a month of
/// negative saving, and a category whose refunds outran its spending is not
/// negative spending — it is simply not represented on this side.
fn net_outflows(rows: &[DayCategoryRow], kind: CategoryKind) -> Vec<(Uuid, Decimal)> {
    category_net_amounts(rows, kind)
        .into_iter()
        .map(|(id, total)| (id, -total))
        .filter(|(_, out)| *out > Decimal::ZERO)
        .collect()
}

/// Categories of `kind` that net inward (money arrived), as positive
/// magnitudes. The inward counterpart of `net_outflows`.
fn net_inflows(rows: &[DayCategoryRow], kind: CategoryKind) -> Vec<(Uuid, Decimal)> {
    category_net_amounts(rows, kind)
        .into_iter()
        .filter(|(_, total)| *total > Decimal::ZERO)
        .collect()
}

/// The three headline numbers: income, expenses and net. Net is the saving:
/// moving money between the user's own accounts is neutral.
pub fn figures(rows: &[DayCategoryRow]) -> Figures {
    let income_categorised: Decimal = net_inflows(rows, CategoryKind::Income)
        .iter()
        .map(|(_, v)| *v)
        .sum();
    let expenses_categorised: Decimal = net_outflows(rows, CategoryKind::Expense)
        .iter()
        .map(|(_, v)| *v)
        .sum();

    // No category to net within, so the sign of each row stands in for its
    // kind. Without this a freshly synced Overview shows
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

    Figures {
        income,
        expenses,
        net: income - expenses,
    }
}

/// One side of the Sankey: categorised slices net per category (same rule as
/// `figures()`), uncategorised rows stay per-row by sign. Positive
/// magnitudes, sorted largest first.
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

/// The Sankey diagram. No `expenses_total` parameter — `sankey()` already
/// computes `figures(rows)` internally for the balancing remainder, and a
/// caller-supplied total would be the only way the collapse threshold and the
/// headline figure could ever disagree.
pub fn sankey(rows: &[DayCategoryRow]) -> Sankey {
    let f = figures(rows);
    let sources = collapse(side(rows, true), f.expenses);
    let destinations = collapse(side(rows, false), f.expenses);

    let remainder = f.income - f.expenses;
    let (not_spent, drawn_from_savings) = if remainder > Decimal::ZERO {
        (Some(remainder), None)
    } else if remainder < Decimal::ZERO {
        // The deficit is carried by `drawn_from_savings` alone — it is never
        // pushed into `sources`, the mirror of `not_spent` never being pushed
        // into `destinations`. Pushing it would add a second `Slice::Other` key
        // on the source side whenever `collapse` already produced one.
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

/// The breakdown keeps this many rows before rolling up into Other.
const BREAKDOWN_KEEP: usize = 7;
/// Below this many months of history a comparison is noise dressed as a
/// number, so it is omitted entirely.
const MIN_BASELINE_MONTHS: usize = 3;
/// How far back `baseline()` walks, and how wide `super::summary` fetches to
/// cover it: a fetch window narrower than the walk would make `baseline()`
/// silently average over fewer months.
pub(super) const BASELINE_MONTHS: u32 = 12;

/// A calendar month. The Overview's period when it is not a custom range.
/// Ordered chronologically: year first, then month.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
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

    /// First and last day, inclusive.
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

/// The rows grouped by calendar month, in one pass. Every per-month figure
/// on the page reads from this rather than re-scanning the window.
fn by_month(rows: &[DayCategoryRow]) -> BTreeMap<Month, Vec<DayCategoryRow>> {
    let mut out: BTreeMap<Month, Vec<DayCategoryRow>> = BTreeMap::new();
    for r in rows {
        out.entry(Month::containing(r.day))
            .or_default()
            .push(r.clone());
    }
    out
}

/// One month's rows in `by_month`'s grouping; empty when it has none.
fn month_rows(buckets: &BTreeMap<Month, Vec<DayCategoryRow>>, m: Month) -> &[DayCategoryRow] {
    buckets.get(&m).map_or(&[], Vec::as_slice)
}

/// One baseline month, reduced to what the comparisons read.
struct MonthSummary {
    figures: Figures,
    expense_side: Vec<SliceAmount>,
}

/// The twelve complete months before the selected one, each already reduced
/// to its figures and its expense side. Months with no rows are present and
/// zero — dropping them would let a quiet month silently raise the average.
struct Baseline {
    months: Vec<MonthSummary>,
}

/// `None` when there is too little history to compare against.
///
/// "History" is counted from the earliest row present, not from the window
/// asked for: a user who connected a bank last month has one month of history
/// no matter how wide a window the caller fetched.
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

/// The mean month of the baseline, as the same three figures.
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

/// The mean monthly amount for one slice across the baseline.
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
    /// Positive.
    pub amount: Decimal,
    pub txn_count: i64,
    /// `None` on the `Other` row, whose membership changes month to month, and
    /// whenever there is too little history.
    pub avg12: Option<Decimal>,
}

/// The breakdown table: expense-side only, the 7 largest by
/// magnitude plus an `Other` rollup.
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
            // Other's membership changes month to month, so a comparison
            // against its own past would compare two different sets.
            avg12: None,
        });
    }
    out
}

/// The trend chart keeps this many categories, Other excluded. The Sankey's
/// cap, so the two surfaces give a category the same chance of its own colour.
const TREND_KEEP: usize = SANKEY_MAX_SLICES;
/// This many of the anchor month's largest slices are always kept, whatever
/// their window total: ranking by total alone would let old one-off spikes
/// crowd the month being looked at into Other.
const TREND_ANCHOR_KEEP: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrendSeries {
    pub slice: Slice,
    /// One value per month, zeros included, so the frontend never aligns
    /// sparse arrays. Positive magnitudes.
    pub values: Vec<Decimal>,
}

/// `months` bars ending at and including `anchor`. The
/// baseline excludes the selected month; the chart includes it as its last bar,
/// because a chart of recent history that stopped before the month you are
/// looking at would be strange to read.
///
/// `fold` is the user's own catch-all category (the seeded "Other"): it is
/// always rolled into the `Other` series, so the legend never shows two
/// slices called Other.
pub fn trend(rows: &[DayCategoryRow], anchor: Month, months: u32, fold: Option<Uuid>) -> Trend {
    let axis: Vec<Month> = (0..months).rev().map(|back| anchor.minus(back)).collect();

    let buckets = by_month(rows);
    let per_month: Vec<Vec<SliceAmount>> = axis
        .iter()
        .map(|m| side(month_rows(&buckets, *m), false))
        .collect();
    let foldable = |s: Slice| fold.is_some_and(|id| s == Slice::Category(id));

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

    // The anchor month's largest first, then the window's largest, until full.
    // Still one choice for the whole window, so every bar stacks the same set.
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
    // Stacked in window-total order, whichever rule let a slice in.
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

/// The trend chart: one series per kept slice, over `months`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trend {
    pub months: Vec<Month>,
    pub series: Vec<TrendSeries>,
}

/// What the Overview reports on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    /// A calendar month, compared against the months before it.
    Month(Month),
    /// A custom range, both edges included. Never compared: "September" and
    /// a range that happens to run 1-30 September are different questions.
    Range { from: NaiveDate, to: NaiveDate },
}

impl Period {
    pub fn bounds(&self) -> (NaiveDate, NaiveDate) {
        match *self {
            Period::Month(m) => m.bounds(),
            Period::Range { from, to } => (from, to),
        }
    }

    /// The days [`summarise`] needs: the period, and for a month the
    /// baseline months before it.
    pub(super) fn window(&self) -> (NaiveDate, NaiveDate) {
        let (from, to) = self.bounds();
        match *self {
            Period::Month(m) => (m.minus(BASELINE_MONTHS).bounds().0, to),
            Period::Range { .. } => (from, to),
        }
    }
}

/// The previous month and the mean month of the baseline, as figures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Comparison {
    pub prev_month: Figures,
    pub avg12: Figures,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    /// Rows behind the period's buckets: paired transfers, neutral rows and
    /// lots are not among them.
    pub txn_count: i64,
    /// At least one row of the period had no rate on its day.
    pub fx_missing: bool,
    pub figures: Figures,
    /// Only for a month period with enough history behind it.
    pub comparison: Option<Comparison>,
    pub sankey: Sankey,
    pub breakdown: Vec<BreakdownEntry>,
}

/// The Overview of `period` from the rows of its [`Period::window`].
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
