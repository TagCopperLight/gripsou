//! The one aggregation behind the Budget Overview, at day grain: a month and a custom range share one code
//! path, and month bucketing stays in `budget::overview::calc` where the boundary rule is testable.

use chrono::NaiveDate;
use uuid::Uuid;

use crate::budget::overview::calc::DayCategoryRow;
use crate::budget::vocab::CategoryKind;
use crate::error::CoreError;

/// Both `/api/budget/summary` and `/api/budget/trend` project this result, so they cannot disagree about a
/// month they both cover.
pub async fn day_category_totals(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<DayCategoryRow>, CoreError> {
    let rows = sqlx::query_as!(
        DayCategoryRow,
        r#"
        -- Days are UTC days, as in the transactions list's filter (`budget_transaction_matches`): a breakdown row
        -- deep-links into that list, so both must bucket days alike.
        --
        -- `txn_day()` is not used: the list does not use it, and agreeing with the list is what counts.
        --
        -- The list's own rows (`budget_transaction_rows`), cash only: buying a security is not spending. The
        -- threshold only feeds `needs_review`, unused here.
        with base as (
            select r.day,
                   r.amount,
                   r.account_currency,
                   -- An orphaned `pair` row lost its partner, so it counts by its sign like any uncategorised row.
                   case when r.is_orphan_transfer then null
                        else r.category_id end as category_id,
                   case when r.is_orphan_transfer then null
                        else r.category_kind end as category_kind,
                   -- Uncategorised rows have no category to net within, so `figures()` reads each row's sign. This is 0 for
                   -- categorised rows and +1/-1 otherwise, so a mixed-sign uncategorised day stays two rows. It only widens
                   -- the grouping key.
                   case when r.category_id is null
                             or r.is_orphan_transfer then sign(r.amount)
                        else 0 end as uncategorised_sign
            from budget_transaction_rows($1, 0) r
            where r.source = 'cash'
              and r.day between $2 and $3
              -- A paired transfer nets to zero, but both halves are dropped rather than left to cancel: a pair
              -- straddling a month end would leave -x in one month and +x in the next, and cross-currency halves
              -- convert at different rates.
              and not r.is_transfer
              -- A neutral category counts toward nothing, except an orphaned `pair` row: it reads as uncategorised
              -- above, so it must not be dropped with its old category.
              and (r.is_orphan_transfer or r.category_kind is distinct from $4)
        ),
        grid as materialized (
            select as_of, currency, rate
            from fx_grid(array(select distinct day from base))
        ),
        reporting as (
            select (select currency from users where id = $1) as code
        ),
        -- Both legs resolve at the transaction's own date, so budget totals and net worth agree on what a euro
        -- was worth that day.
        converted as (
            select b.*, fx_convert(b.amount, afx.rate, rfx.rate) as reporting_amount
            from base b
            left join grid afx on afx.as_of = b.day and afx.currency = b.account_currency
            left join grid rfx on rfx.as_of = b.day
                              and rfx.currency = (select code from reporting)
        )
        select b.day as "day!",
               b.category_id as "category_id?",
               b.category_kind as "category_kind?: CategoryKind",
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
        CategoryKind::Neutral as CategoryKind,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
