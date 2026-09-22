use chrono::NaiveDate;
use gripsou_core::budget::overview::{
    BreakdownEntry, Month, Slice, baseline, baseline_figures, breakdown, figures, rows_in, sankey,
    trend,
};
use gripsou_core::repo::budget::summary::DayCategoryRow;
use rust_decimal::Decimal;
use uuid::Uuid;

fn eur(units: i64) -> Decimal {
    Decimal::new(units * 100, 2)
}

fn day(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

/// One bucket. `kind` of `None` means uncategorised.
fn row(d: NaiveDate, cat: Option<Uuid>, kind: Option<&str>, amount: Decimal) -> DayCategoryRow {
    DayCategoryRow {
        day: d,
        category_id: cat,
        category_kind: kind.map(str::to_string),
        amount,
        txn_count: 1,
        fx_missing: false,
        reporting_fx_missing: false,
    }
}

#[test]
fn income_and_expenses_split_by_kind() {
    let salary = Uuid::new_v4();
    let rent = Uuid::new_v4();
    let rows = vec![
        row(day(2026, 3, 1), Some(salary), Some("income"), eur(3000)),
        row(day(2026, 3, 5), Some(rent), Some("expense"), eur(-900)),
    ];
    let f = figures(&rows);
    assert_eq!(f.income, eur(3000));
    assert_eq!(f.expenses, eur(900), "expenses are reported positive");
    assert_eq!(f.net, eur(2100));
    assert_eq!(f.saved, Decimal::ZERO);
}

#[test]
fn uncategorised_money_counts_by_sign() {
    // Spec 2.2: the sign stands in for the kind there is no category to read.
    let rows = vec![
        row(day(2026, 3, 1), None, None, eur(200)),
        row(day(2026, 3, 5), None, None, eur(-50)),
    ];
    let f = figures(&rows);
    assert_eq!(f.income, eur(200));
    assert_eq!(f.expenses, eur(50));
    assert_eq!(f.net, eur(150));
}

#[test]
fn uncategorised_money_counts_by_sign_on_the_same_day() {
    // The same rule as `uncategorised_money_counts_by_sign`, but both rows
    // fall on one day — the payday shape (Finding 1): the SQL layer must
    // hand `figures()` two same-day rows, one per sign, rather than one
    // already-netted row, or this test would see near-zero everything.
    let rows = vec![
        row(day(2026, 3, 1), None, None, eur(200)),
        row(day(2026, 3, 1), None, None, eur(-50)),
    ];
    let f = figures(&rows);
    assert_eq!(f.income, eur(200));
    assert_eq!(f.expenses, eur(50));
    assert_eq!(f.net, eur(150));
}

#[test]
fn saved_is_the_net_outflow_of_internal_categories() {
    let investments = Uuid::new_v4();
    let rows = vec![
        row(
            day(2026, 3, 1),
            Some(investments),
            Some("internal"),
            eur(-800),
        ),
        row(
            day(2026, 3, 9),
            Some(investments),
            Some("internal"),
            eur(100),
        ),
    ];
    let f = figures(&rows);
    assert_eq!(f.saved, eur(700), "net, not gross");
    assert_eq!(f.expenses, Decimal::ZERO, "internal money is not spending");
}

#[test]
fn a_paired_transfer_nets_to_zero_and_saves_nothing() {
    let internal = Uuid::new_v4();
    let rows = vec![
        row(day(2026, 3, 1), Some(internal), Some("internal"), eur(-500)),
        row(day(2026, 3, 1), Some(internal), Some("internal"), eur(500)),
    ];
    assert_eq!(figures(&rows).saved, Decimal::ZERO);
}

#[test]
fn an_internal_category_that_nets_inward_contributes_nothing() {
    // A month where savings were drawn down is not a month of negative saving.
    let savings = Uuid::new_v4();
    let rows = vec![row(
        day(2026, 3, 1),
        Some(savings),
        Some("internal"),
        eur(400),
    )];
    assert_eq!(figures(&rows).saved, Decimal::ZERO);
}

#[test]
fn sankey_balances_in_a_surplus_month() {
    let salary = Uuid::new_v4();
    let rent = Uuid::new_v4();
    let investments = Uuid::new_v4();
    let rows = vec![
        row(day(2026, 3, 1), Some(salary), Some("income"), eur(3000)),
        row(day(2026, 3, 5), Some(rent), Some("expense"), eur(-900)),
        row(
            day(2026, 3, 8),
            Some(investments),
            Some("internal"),
            eur(-800),
        ),
    ];
    let s = sankey(&rows);
    assert_eq!(s.sources.len(), 1);
    assert_eq!(s.sources[0].amount, eur(3000));
    assert_eq!(s.not_spent, Some(eur(1300)), "3000 - 900 - 800");
    assert_eq!(s.drawn_from_savings, None);
    let out: Decimal =
        s.destinations.iter().map(|d| d.amount).sum::<Decimal>() + s.not_spent.unwrap();
    assert_eq!(out, eur(3000), "the diagram balances");
}

#[test]
fn a_deficit_month_draws_from_savings_instead_of_going_negative() {
    let salary = Uuid::new_v4();
    let rent = Uuid::new_v4();
    let rows = vec![
        row(day(2026, 3, 1), Some(salary), Some("income"), eur(1000)),
        row(day(2026, 3, 5), Some(rent), Some("expense"), eur(-1400)),
    ];
    let s = sankey(&rows);
    assert_eq!(s.not_spent, None, "no negative flow is ever drawn");
    assert_eq!(s.drawn_from_savings, Some(eur(400)));
    assert_eq!(
        s.sources.len(),
        1,
        "the deficit is carried by drawn_from_savings, not an extra source"
    );
    let sources: Decimal = s.sources.iter().map(|x| x.amount).sum();
    let destinations: Decimal = s.destinations.iter().map(|x| x.amount).sum();
    assert_eq!(
        sources + s.drawn_from_savings.unwrap_or(Decimal::ZERO),
        destinations + s.not_spent.unwrap_or(Decimal::ZERO),
        "the diagram still balances"
    );
}

#[test]
fn not_spent_and_drawn_from_savings_are_never_both_present() {
    for (income, expense) in [(1000i64, 400i64), (400, 1000), (500, 500)] {
        let rows = vec![
            row(
                day(2026, 3, 1),
                Some(Uuid::new_v4()),
                Some("income"),
                eur(income),
            ),
            row(
                day(2026, 3, 5),
                Some(Uuid::new_v4()),
                Some("expense"),
                eur(-expense),
            ),
        ];
        let s = sankey(&rows);
        assert!(
            s.not_spent.is_none() || s.drawn_from_savings.is_none(),
            "income {income}, expense {expense}"
        );
    }
}

#[test]
fn uncategorised_appears_on_the_side_its_sign_puts_it() {
    let rows = vec![
        row(day(2026, 3, 1), None, None, eur(200)),
        row(day(2026, 3, 5), None, None, eur(-50)),
    ];
    let s = sankey(&rows);
    assert!(s.sources.iter().any(|x| x.slice == Slice::Uncategorised));
    assert!(
        s.destinations
            .iter()
            .any(|x| x.slice == Slice::Uncategorised)
    );
}

#[test]
fn small_slices_roll_into_other() {
    // Spec 4.3: a side keeps slices at >= 2% of the period's expenses, capped
    // at 8; the remainder becomes Other.
    let big = Uuid::new_v4();
    let mut rows = vec![row(day(2026, 3, 1), Some(big), Some("expense"), eur(-1000))];
    for _ in 0..5 {
        rows.push(row(
            day(2026, 3, 2),
            Some(Uuid::new_v4()),
            Some("expense"),
            eur(-10),
        ));
    }
    let s = sankey(&rows);
    assert_eq!(s.destinations.len(), 2, "one real slice plus Other");
    assert_eq!(s.destinations[1].slice, Slice::Other);
    assert_eq!(s.destinations[1].amount, eur(50));
}

#[test]
fn a_side_never_exceeds_eight_slices_plus_other() {
    let mut rows = vec![];
    for _ in 0..12 {
        rows.push(row(
            day(2026, 3, 1),
            Some(Uuid::new_v4()),
            Some("expense"),
            eur(-100),
        ));
    }
    let s = sankey(&rows);
    assert_eq!(s.destinations.len(), 9, "8 slices plus Other");
    assert_eq!(s.destinations[8].slice, Slice::Other);
    assert_eq!(s.destinations[8].amount, eur(400), "the remaining four");
}

#[test]
fn deficit_does_not_duplicate_the_other_key() {
    // Finding 1: 9 income categories of 100 each (one gets rolled into Other
    // by the 8-slice cap) against an expense of 2000. The deficit must not
    // push a second `Slice::Other` onto `sources`.
    let mut rows = vec![];
    for _ in 0..9 {
        rows.push(row(
            day(2026, 3, 1),
            Some(Uuid::new_v4()),
            Some("income"),
            eur(100),
        ));
    }
    let big_expense = Uuid::new_v4();
    rows.push(row(
        day(2026, 3, 5),
        Some(big_expense),
        Some("expense"),
        eur(-2000),
    ));

    let s = sankey(&rows);
    assert_eq!(
        s.drawn_from_savings,
        Some(eur(1100)),
        "900 income - 2000 expenses"
    );
    assert_eq!(s.not_spent, None);
    assert_eq!(
        s.sources.iter().filter(|x| x.slice == Slice::Other).count(),
        1,
        "only collapse's own Other, not a second one from the deficit"
    );
    let sources: Decimal = s.sources.iter().map(|x| x.amount).sum();
    let destinations: Decimal = s.destinations.iter().map(|x| x.amount).sum();
    assert_eq!(
        sources + s.drawn_from_savings.unwrap(),
        destinations,
        "the diagram still balances"
    );
}

#[test]
fn category_net_reversal_keeps_the_diagram_balanced() {
    // Finding 2: category B's refunds (+200) exceed its spending, so its
    // period net is inward. figures() and side() must agree that only
    // category A (net -500) is an expense; category B contributes to
    // neither income nor expenses.
    let salary = Uuid::new_v4();
    let category_a = Uuid::new_v4();
    let category_b = Uuid::new_v4();
    let rows = vec![
        row(day(2026, 3, 1), Some(salary), Some("income"), eur(1000)),
        row(
            day(2026, 3, 5),
            Some(category_a),
            Some("expense"),
            eur(-500),
        ),
        row(day(2026, 3, 9), Some(category_b), Some("expense"), eur(200)),
    ];

    let f = figures(&rows);
    assert_eq!(f.income, eur(1000));
    assert_eq!(f.expenses, eur(500), "only category A nets outward");

    let s = sankey(&rows);
    let destinations: Decimal = s.destinations.iter().map(|x| x.amount).sum();
    assert_eq!(
        destinations, f.expenses,
        "destinations agree with the headline"
    );

    let sources: Decimal = s.sources.iter().map(|x| x.amount).sum();
    assert_eq!(
        sources + s.drawn_from_savings.unwrap_or(Decimal::ZERO),
        destinations + s.not_spent.unwrap_or(Decimal::ZERO),
        "the diagram balances"
    );
}

#[test]
fn internal_branches_stay_uncapped_and_before_the_trailing_other() {
    // Finding 3: internal branches are exempt from the 2%/8 cap, but must be
    // inserted before Other so Other stays last.
    let internal_a = Uuid::new_v4();
    let internal_b = Uuid::new_v4();
    let internal_c = Uuid::new_v4();
    let mut rows = vec![
        row(
            day(2026, 3, 1),
            Some(internal_a),
            Some("internal"),
            eur(-100),
        ),
        row(
            day(2026, 3, 1),
            Some(internal_b),
            Some("internal"),
            eur(-200),
        ),
        row(
            day(2026, 3, 1),
            Some(internal_c),
            Some("internal"),
            eur(-300),
        ),
    ];
    for _ in 0..10 {
        rows.push(row(
            day(2026, 3, 2),
            Some(Uuid::new_v4()),
            Some("expense"),
            eur(-100),
        ));
    }

    let s = sankey(&rows);
    assert_eq!(
        s.destinations.last().unwrap().slice,
        Slice::Other,
        "Other is always last"
    );
    for id in [internal_a, internal_b, internal_c] {
        assert!(
            s.destinations
                .iter()
                .any(|x| x.slice == Slice::Category(id)),
            "internal category {id} must survive the cap"
        );
    }
}

#[test]
fn a_month_parses_and_round_trips() {
    let m = Month::parse("2026-09").unwrap();
    assert_eq!((m.year, m.month), (2026, 9));
    assert_eq!(m.label(), "2026-09");
    assert_eq!(Month::parse("2026-13"), None);
    assert_eq!(Month::parse("nonsense"), None);
    assert_eq!(Month::parse("2026-9"), None, "zero-padded only");
}

#[test]
fn month_bounds_cover_the_whole_month() {
    let m = Month::parse("2026-02").unwrap();
    assert_eq!(m.bounds(), (day(2026, 2, 1), day(2026, 2, 28)));
    let leap = Month::parse("2024-02").unwrap();
    assert_eq!(leap.bounds().1, day(2024, 2, 29));
    let dec = Month::parse("2026-12").unwrap();
    assert_eq!(dec.bounds(), (day(2026, 12, 1), day(2026, 12, 31)));
}

#[test]
fn stepping_back_crosses_the_year_boundary() {
    let jan = Month::parse("2026-01").unwrap();
    assert_eq!(jan.prev().label(), "2025-12");
    assert_eq!(jan.minus(12).label(), "2025-01");
    assert_eq!(jan.minus(0).label(), "2026-01");
}

#[test]
fn rows_in_is_inclusive_at_both_edges() {
    let rows = vec![
        row(day(2026, 2, 28), None, None, eur(-1)),
        row(day(2026, 3, 1), None, None, eur(-2)),
        row(day(2026, 3, 31), None, None, eur(-3)),
        row(day(2026, 4, 1), None, None, eur(-4)),
    ];
    let got = rows_in(&rows, day(2026, 3, 1), day(2026, 3, 31));
    assert_eq!(got.len(), 2);
    assert_eq!(got.iter().map(|r| r.amount).sum::<Decimal>(), eur(-5));
}

#[test]
fn the_breakdown_is_expense_side_only() {
    // Spec 2.3: SHARE is share of the period's expenses, which is meaningless
    // for an income row.
    let salary = Uuid::new_v4();
    let rent = Uuid::new_v4();
    let investments = Uuid::new_v4();
    let rows = vec![
        row(day(2026, 3, 1), Some(salary), Some("income"), eur(3000)),
        row(day(2026, 3, 5), Some(rent), Some("expense"), eur(-900)),
        row(
            day(2026, 3, 8),
            Some(investments),
            Some("internal"),
            eur(-800),
        ),
    ];
    let b = breakdown(&rows, None);
    assert_eq!(b.len(), 1);
    assert_eq!(b[0].slice, Slice::Category(rent));
    assert_eq!(b[0].amount, eur(900));
}

#[test]
fn the_breakdown_includes_uncategorised_outflows() {
    let rows = vec![
        row(day(2026, 3, 1), None, None, eur(-120)),
        row(day(2026, 3, 5), None, None, eur(400)),
    ];
    let b = breakdown(&rows, None);
    assert_eq!(b.len(), 1, "the inflow is not a breakdown row");
    assert_eq!(b[0].slice, Slice::Uncategorised);
    assert_eq!(b[0].amount, eur(120));
}

#[test]
fn the_breakdown_keeps_seven_then_rolls_up() {
    let mut rows = vec![];
    for i in 1..=10 {
        rows.push(row(
            day(2026, 3, 1),
            Some(Uuid::new_v4()),
            Some("expense"),
            eur(-i * 10),
        ));
    }
    let b = breakdown(&rows, None);
    assert_eq!(b.len(), 8, "7 plus Other");
    assert_eq!(b[7].slice, Slice::Other);
    // The three smallest: 10 + 20 + 30.
    assert_eq!(b[7].amount, eur(60));
    assert_eq!(b[7].avg12, None, "Other carries no comparison");
    assert_eq!(b[0].amount, eur(100), "largest first");
}

#[test]
fn breakdown_rows_carry_their_transaction_count() {
    let rent = Uuid::new_v4();
    let rows = vec![
        DayCategoryRow {
            txn_count: 3,
            ..row(day(2026, 3, 1), Some(rent), Some("expense"), eur(-100))
        },
        DayCategoryRow {
            txn_count: 2,
            ..row(day(2026, 3, 5), Some(rent), Some("expense"), eur(-50))
        },
    ];
    let b = breakdown(&rows, None);
    assert_eq!(b[0].txn_count, 5);
}

#[test]
fn the_baseline_excludes_the_selected_month() {
    // Spec 4.4: excluding it so a spike cannot inflate the average it is being
    // judged against.
    let rent = Uuid::new_v4();
    let mut rows = vec![];
    // Twelve months at 100 each: 2025-09 through 2026-08.
    for m in 9..=20u32 {
        let (y, mm) = if m <= 12 { (2025, m) } else { (2026, m - 12) };
        rows.push(row(day(y, mm, 5), Some(rent), Some("expense"), eur(-100)));
    }
    // ...and a 1000 spike in the selected month.
    rows.push(row(
        day(2026, 9, 5),
        Some(rent),
        Some("expense"),
        eur(-1000),
    ));

    let b = baseline(&rows, Month::parse("2026-09").unwrap()).unwrap();
    let f = baseline_figures(&b);
    assert_eq!(f.expenses, eur(100), "the spike is not in its own baseline");
}

#[test]
fn the_baseline_needs_three_months_of_history() {
    let rent = Uuid::new_v4();
    let rows = vec![
        row(day(2026, 7, 5), Some(rent), Some("expense"), eur(-100)),
        row(day(2026, 8, 5), Some(rent), Some("expense"), eur(-100)),
    ];
    assert!(
        baseline(&rows, Month::parse("2026-09").unwrap()).is_none(),
        "two months is noise dressed as a comparison"
    );

    let mut three = rows.clone();
    three.push(row(day(2026, 6, 5), Some(rent), Some("expense"), eur(-100)));
    assert!(baseline(&three, Month::parse("2026-09").unwrap()).is_some());
}

#[test]
fn a_short_baseline_averages_over_what_exists() {
    // Five months at 100: the mean is 100, not 500/12.
    let rent = Uuid::new_v4();
    let mut rows = vec![];
    for m in 4..=8u32 {
        rows.push(row(day(2026, m, 5), Some(rent), Some("expense"), eur(-100)));
    }
    let b = baseline(&rows, Month::parse("2026-09").unwrap()).unwrap();
    assert_eq!(baseline_figures(&b).expenses, eur(100));
}

#[test]
fn a_month_with_no_rows_still_counts_as_a_month() {
    // Four months of history, one of them empty: the mean is over four, not
    // three, or a quiet month would silently raise the average.
    let rent = Uuid::new_v4();
    let mut rows = vec![];
    for m in [5u32, 6, 8] {
        rows.push(row(day(2026, m, 5), Some(rent), Some("expense"), eur(-120)));
    }
    let b = baseline(&rows, Month::parse("2026-09").unwrap()).unwrap();
    assert_eq!(baseline_figures(&b).expenses, eur(90), "360 over 4 months");
}

#[test]
fn breakdown_rows_carry_their_category_baseline() {
    let rent = Uuid::new_v4();
    let mut rows = vec![];
    for m in 3..=8u32 {
        rows.push(row(day(2026, m, 5), Some(rent), Some("expense"), eur(-60)));
    }
    let selected = Month::parse("2026-09").unwrap();
    let b = baseline(&rows, selected).unwrap();
    rows.push(row(day(2026, 9, 5), Some(rent), Some("expense"), eur(-90)));

    let (from, to) = selected.bounds();
    let period: Vec<DayCategoryRow> = rows_in(&rows, from, to).into_iter().cloned().collect();
    let entries: Vec<BreakdownEntry> = breakdown(&period, Some(&b));
    assert_eq!(entries[0].amount, eur(90));
    assert_eq!(entries[0].avg12, Some(eur(60)));
}

#[test]
fn the_trend_ends_at_the_anchor_month() {
    // 12 bars ending at the selected month (UI-design 1.6), unlike the
    // baseline, which excludes it.
    let (months, _) = trend(&[], Month::parse("2026-09").unwrap(), 12);
    assert_eq!(months.len(), 12);
    assert_eq!(months[11].label(), "2026-09");
    assert_eq!(months[0].label(), "2025-10");
}

#[test]
fn every_trend_series_has_one_value_per_month() {
    let rent = Uuid::new_v4();
    let rows = vec![
        row(day(2026, 8, 5), Some(rent), Some("expense"), eur(-100)),
        row(day(2026, 9, 5), Some(rent), Some("expense"), eur(-120)),
    ];
    let (months, series) = trend(&rows, Month::parse("2026-09").unwrap(), 12);
    assert_eq!(series.len(), 1);
    assert_eq!(series[0].values.len(), months.len(), "zeros included");
    assert_eq!(series[0].values[10], eur(100));
    assert_eq!(series[0].values[11], eur(120));
    assert_eq!(series[0].values[0], Decimal::ZERO);
}

#[test]
fn the_trend_keeps_the_top_five_across_the_whole_window() {
    // Chosen once for the window, never per month: a stack whose composition
    // changed bar to bar would make the legend a lie.
    let mut rows = vec![];
    for i in 1..=8i64 {
        rows.push(row(
            day(2026, 9, 5),
            Some(Uuid::new_v4()),
            Some("expense"),
            eur(-i * 10),
        ));
    }
    let (_, series) = trend(&rows, Month::parse("2026-09").unwrap(), 12);
    assert_eq!(series.len(), 6, "5 plus Other");
    assert_eq!(series[5].slice, Slice::Other);
    // The three smallest: 10 + 20 + 30.
    assert_eq!(series[5].values[11], eur(60));
}

#[test]
fn a_category_big_in_one_month_only_still_makes_the_top_five() {
    let spike = Uuid::new_v4();
    let steady = Uuid::new_v4();
    let mut rows = vec![row(
        day(2026, 3, 5),
        Some(spike),
        Some("expense"),
        eur(-5000),
    )];
    for m in 1..=12u32 {
        let (y, mm) = if m <= 9 { (2026, m) } else { (2025, m) };
        rows.push(row(day(y, mm, 5), Some(steady), Some("expense"), eur(-10)));
    }
    let (_, series) = trend(&rows, Month::parse("2026-09").unwrap(), 12);
    assert_eq!(
        series[0].slice,
        Slice::Category(spike),
        "ranked by window total"
    );
    assert_eq!(
        series[0].values[11],
        Decimal::ZERO,
        "and zero in months it was absent"
    );
}

#[test]
fn summary_breakdown_and_trend_agree_on_a_shared_month() {
    // Spec 9: /summary and /trend must never disagree about a month they
    // both cover. Both reduce through `expense_side_amounts` today, so this
    // holds by construction — this test pins that fact so a future change
    // that breaks the invariant fails here, not as a support ticket about
    // two numbers on one page that don't match.
    let rent = Uuid::new_v4();
    let groceries = Uuid::new_v4();
    let month = Month::parse("2026-09").unwrap();
    let (from, to) = month.bounds();
    let rows = vec![
        row(day(2026, 9, 3), Some(rent), Some("expense"), eur(-900)),
        row(
            day(2026, 9, 10),
            Some(groceries),
            Some("expense"),
            eur(-150),
        ),
        row(day(2026, 9, 20), None, None, eur(-40)),
    ];

    // Few enough slices that neither breakdown's top-7 cap nor trend's
    // top-5 cap rolls anything into `Other` — so the two slice sets are
    // identical and every entry has a like-for-like value to compare.
    let period: Vec<DayCategoryRow> = rows_in(&rows, from, to).into_iter().cloned().collect();
    let breakdown_rows = breakdown(&period, None);

    let (months, series) = trend(&rows, month, 1);
    assert_eq!(months, vec![month]);
    let last = months.len() - 1;

    assert_eq!(
        breakdown_rows.len(),
        3,
        "no roll-up in play, on either side"
    );
    for entry in &breakdown_rows {
        let trend_value = series
            .iter()
            .find(|s| s.slice == entry.slice)
            .map(|s| s.values[last])
            .unwrap_or(Decimal::ZERO);
        assert_eq!(
            trend_value, entry.amount,
            "breakdown and trend disagree on {:?}",
            entry.slice
        );
    }
}
