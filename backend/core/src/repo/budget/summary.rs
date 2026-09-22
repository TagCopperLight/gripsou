//! The one aggregation behind the Budget Overview.
//!
//! Day grain, not month grain, for three reasons: a calendar month and an
//! arbitrary custom range become the same code path (a month is a day filter);
//! month bucketing moves into `core::budget::overview`, where the boundary rule
//! is a readable, testable function rather than a `date_trunc`; and the volume
//! is trivial, because only days carrying transactions produce rows.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

/// One (day, category) bucket, already in the reader's reporting currency.
#[derive(Debug, Clone)]
pub struct DayCategoryRow {
    pub day: NaiveDate,
    /// `None` is the Uncategorised slice — on day one, most of them.
    pub category_id: Option<Uuid>,
    /// `expense` | `income` | `internal`. Never `excluded`: those rows are
    /// dropped by the query. `None` when `category_id` is.
    pub category_kind: Option<String>,
    /// Signed, in the reporting currency, converted at `day`'s rate. Zero when
    /// the rate was unknown — see `fx_missing`.
    pub amount: Decimal,
    pub txn_count: i64,
    /// At least one row in this bucket could not be valued, so the bucket is
    /// understated.
    pub fx_missing: bool,
    /// The reader's reporting currency had no rate on this day, so this
    /// bucket is in the pivot currency. Unlike `fx_missing`, nothing is
    /// missing from the sum — the whole sum is in a different currency.
    pub reporting_fx_missing: bool,
}

/// Every (day, category) bucket between `from` and `to` inclusive.
///
/// Both `/api/budget/summary` and `/api/budget/trend` project this one result,
/// so they cannot disagree about a month they both cover.
pub async fn day_category_totals(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<DayCategoryRow>, CoreError> {
    let rows = sqlx::query_as!(
        DayCategoryRow,
        r#"
        -- The day expression is `(ts at time zone 'utc')::date`, byte-identical
        -- to the transactions list (query.rs:1057). A breakdown row deep-links
        -- into that list with the period as a filter, so the two must bucket
        -- days the same way or the Overview says EUR 620 and the list it opens
        -- shows EUR 580, with nothing on screen to explain the gap.
        --
        -- `txn_day()` is deliberately not used: it exists for the balance walk,
        -- the list does not use it, and agreeing with the list is what counts.
        with base as (
            select (t.ts at time zone 'utc')::date as day,
                   t.amount,
                   a.currency as account_currency,
                   t.budget_category_id as category_id,
                   bc.kind as category_kind,
                   -- Uncategorised rows have no category to net within, so
                   -- `figures()` (spec 2.2) reads the sign of each row
                   -- directly to decide income vs expense. Grouping only by
                   -- (day, category_id, category_kind) would net an
                   -- uncategorised payday's salary against its coffee before
                   -- Rust ever saw either sign. This discriminator is 0 for
                   -- every categorised row (so their grouping is completely
                   -- unaffected — netting per category is exactly the rule
                   -- there, spec 4.1) and +1/-1 for an uncategorised row,
                   -- splitting a mixed-sign uncategorised day into two rows
                   -- instead of one netted one. It exists only to widen the
                   -- grouping key; nothing downstream needs its value.
                   case when t.budget_category_id is null then sign(t.amount)
                        else 0 end as uncategorised_sign
            from transaction t
            join account a    on a.id = t.account_id
            join connection c on c.id = a.connection_id
            left join budget_category bc on bc.id = t.budget_category_id
            where c.user_id = $1
              and (t.ts at time zone 'utc')::date between $2 and $3
              -- Mirrors query.rs:989 exactly, including the `external_id`
              -- scoping: a transfer into the PEA is the other half of an
              -- outflow already listed on the checking account, and a provider
              -- buy is the cash leg of a purchase the lot table already holds.
              -- The list makes these unreachable; an aggregate that kept them
              -- would double-count the Sankey.
              and not (a.type_key = 'pea'
                       and t.external_id is not null
                       and t.type in ('transfer', 'buy', 'sell'))
              -- Design 6.2: an `excluded` category appears nowhere and counts
              -- toward nothing. `internal` is NOT dropped — the Sankey needs
              -- it, because netting it is how a paired transfer disappears.
              and coalesce(bc.kind, '') <> 'excluded'
        ),
        -- The distinct days actually present, not every day in the window.
        -- 0019 dropped valuation_grid's (uuid, date, date) overload precisely
        -- so the caller and the grid unnest the same list: the join is on
        -- equality of as_of, and a self-generated series that disagreed would
        -- read zero rather than fail.
        days as (select distinct day from base),
        grid as materialized (
            select as_of, currency, unit_value
            from valuation_grid($1, array(select day from days)::date[])
            where kind = 'cash'
        ),
        reporting as (
            select coalesce((select prefs->>'currency' from users where id = $1), 'EUR') as code
        )
        select b.day as "day!",
               b.category_id as "category_id?",
               b.category_kind as "category_kind?",
               -- Both legs resolve at the transaction's own date: that is what
               -- keeps budget totals and net worth from disagreeing about what
               -- a euro was worth on a given day.
               coalesce(sum(b.amount * afx.unit_value
                            / coalesce(nullif(rfx.unit_value, 0), 1)), 0) as "amount!",
               count(*) as "txn_count!",
               -- Keyed on the account leg only: a missing reporting rate
               -- degrades to the pivot (below) rather than dropping anything
               -- from the sum, so it must not set this flag.
               coalesce(bool_or(afx.unit_value is null), false) as "fx_missing!",
               -- Mirrors reporting_fx_asof()'s own guard (migration 0026), so
               -- this can never disagree with the net worth dashboard about
               -- whether the reporting-currency fallback fired.
               reporting_fx_degraded($1, b.day) as "reporting_fx_missing!"
        from base b
        left join grid afx on afx.as_of = b.day and afx.currency = b.account_currency
        left join grid rfx on rfx.as_of = b.day
                          and rfx.currency = (select code from reporting)
        group by b.day, b.category_id, b.category_kind, b.uncategorised_sign
        order by b.day, b.category_id
        "#,
        user_id,
        from,
        to,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
