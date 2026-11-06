//! Inputs of the annualised return: every non-cash position of a user (held
//! ones valued by `valuation::holdings`, sold-out ones at zero) and the cash flows
//! that built them, each converted to the reporting currency on its own day.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;
use crate::returns::{CashFlow, Position};

pub struct ReturnInputs {
    /// The user's today (`user_today`), the day the current value is taken.
    pub today: NaiveDate,
    pub positions: Vec<Position>,
    pub flows: Vec<CashFlow>,
}

pub async fn load(pool: &sqlx::PgPool, user_id: Uuid) -> Result<ReturnInputs, CoreError> {
    let today = crate::repo::prefs::today(pool, user_id).await?;

    // Held positions: the Holdings table's own rows, so the value is the figure
    // the user already sees there (one valuation path).
    let mut positions: Vec<Position> = crate::repo::valuation::holdings(pool, user_id)
        .await?
        .into_iter()
        .filter(|h| h.kind != "cash")
        .map(|h| Position {
            holding_id: h.holding_id,
            account_id: h.account_id,
            name: h.instrument_name,
            complete: h.unexplained_quantity.is_zero(),
            value: h.value,
            fx_missing: h.fx_missing,
        })
        .collect();

    // Sold-out positions: `holdings` skips quantity 0, but their lots are part
    // of what the money earned. Worth nothing today, complete when the sells
    // match the buys.
    let sold_out = sqlx::query!(
        r#"
        select h.id as "holding_id!", h.account_id as "account_id!", i.name as "name!",
               sum(case when l.side = 'buy' then l.quantity else -l.quantity end) as "explained!"
        from holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        join instrument i on i.id = h.instrument_id
        join lot l        on l.holding_id = h.id
        where c.user_id = $1 and h.quantity = 0 and i.kind <> 'cash'
        group by h.id, h.account_id, i.name
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    positions.extend(sold_out.into_iter().map(|r| Position {
        holding_id: r.holding_id,
        account_id: r.account_id,
        name: r.name,
        complete: r.explained.is_zero(),
        value: Decimal::ZERO,
        fx_missing: false,
    }));

    // Lots and dividends, each converted on its own day from the account's
    // currency into the reporting currency. A NULL amount means a rate is
    // missing for that day. A dividend's day is the day it reached the
    // balance, as the backfill dates every cash move.
    let rows = sqlx::query!(
        r#"
        select l.holding_id as "holding_id?", h.account_id as "account_id!",
               l.acquired_on as "day!", l.side = 'buy' as "buy!",
               fx_convert(lot_cash_amount(l.side, l.quantity, l.unit_price, l.fee),
                          fx_asof(a.currency, l.acquired_on),
                          reporting_fx_asof($1, l.acquired_on)) as "amount?"
        from lot l
        join holding h    on h.id = l.holding_id
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        join instrument i on i.id = h.instrument_id
        where c.user_id = $1 and i.kind <> 'cash'
        union all
        select null::uuid, t.account_id, d.day, false,
               fx_convert(t.amount, fx_asof(a.currency, d.day), reporting_fx_asof($1, d.day))
        from transaction t
        join account a    on a.id = t.account_id
        join connection c on c.id = a.connection_id
        cross join lateral (
            select txn_day(account_trusts_booked_on(t.account_id), t.booked_on, t.spent_on) as day
        ) d
        where c.user_id = $1 and t.type = 'dividend'
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    let flows = rows
        .into_iter()
        .map(|r| CashFlow {
            holding_id: r.holding_id,
            account_id: r.account_id,
            day: r.day,
            amount: r.amount,
            buy: r.buy,
        })
        .collect();

    Ok(ReturnInputs {
        today,
        positions,
        flows,
    })
}
