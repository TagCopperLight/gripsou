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
    /// `expense` | `income`. Never `neutral`: those rows are dropped by
    /// the query. `None` when `category_id` is.
    pub category_kind: Option<String>,
    /// Signed, in the reporting currency, converted at `day`'s rates. A row
    /// with no rate on its day is left out — see `fx_missing`.
    pub amount: Decimal,
    pub txn_count: i64,
    /// At least one row in this bucket had no rate on its day, for its
    /// account's currency or the reader's, and is left out of `amount`.
    pub fx_missing: bool,
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
        -- Days are UTC days, as in the transactions list's filter
        -- (`budget_transaction_matches`). A breakdown row deep-links into that
        -- list with the period as a filter, so the two must bucket days the
        -- same way or the Overview says EUR 620 and the list it opens shows
        -- EUR 580, with nothing on screen to explain the gap.
        --
        -- `txn_day()` is deliberately not used: it exists for the balance walk,
        -- the list does not use it, and agreeing with the list is what counts.
        --
        -- The rows are the list's own (`budget_transaction_rows`), cash only:
        -- a lot is the record of an investment, and buying a security is not
        -- spending. The threshold only feeds `needs_review`, unused here.
        with base as (
            select r.day,
                   r.amount,
                   r.account_currency,
                   -- An orphaned `pair` row lost its partner: the user
                   -- recategorised the other half. What is left is money that
                   -- moved with nothing on the other side, so it counts by its
                   -- sign like any uncategorised row.
                   case when r.is_orphan_transfer then null
                        else r.category_id end as category_id,
                   case when r.is_orphan_transfer then null
                        else r.category_kind end as category_kind,
                   -- Uncategorised rows have no category to net within, so
                   -- `figures()` reads the sign of each row directly to decide
                   -- income vs expense. This discriminator is 0 for every
                   -- categorised row and +1/-1 for an uncategorised one, so a
                   -- mixed-sign uncategorised day becomes two rows instead of
                   -- its salary netted against its coffee. It only widens the
                   -- grouping key; nothing downstream reads its value.
                   case when r.category_id is null
                             or r.is_orphan_transfer then sign(r.amount)
                        else 0 end as uncategorised_sign
            from budget_transaction_rows($1, 0) r
            where r.source = 'cash'
              and r.day between $2 and $3
              -- A paired transfer nets to zero by construction, so both halves
              -- are dropped rather than left to cancel: a pair straddling a
              -- month end would leave -x in one month and +x in the next, and
              -- cross-currency halves convert at different rates.
              and not r.is_transfer
              -- A neutral category (Internal transfer, Investments, Savings,
              -- Ignore) counts toward nothing. Except an orphaned `pair` row:
              -- it is read above as uncategorised, so it must not be dropped
              -- with its old category.
              and (r.is_orphan_transfer or coalesce(r.category_kind, '') <> 'neutral')
        ),
        grid as materialized (
            select as_of, currency, rate
            from fx_grid(array(select distinct day from base))
        ),
        reporting as (
            select (select currency from users where id = $1) as code
        ),
        -- Both legs resolve at the transaction's own date: that is what
        -- keeps budget totals and net worth from disagreeing about what a
        -- euro was worth on a given day.
        converted as (
            select b.*, fx_convert(b.amount, afx.rate, rfx.rate) as reporting_amount
            from base b
            left join grid afx on afx.as_of = b.day and afx.currency = b.account_currency
            left join grid rfx on rfx.as_of = b.day
                              and rfx.currency = (select code from reporting)
        )
        select b.day as "day!",
               b.category_id as "category_id?",
               b.category_kind as "category_kind?",
               coalesce(sum(b.reporting_amount), 0) as "amount!",
               count(*) as "txn_count!",
               coalesce(bool_or(b.reporting_amount is null), false) as "fx_missing!"
        from converted b
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
