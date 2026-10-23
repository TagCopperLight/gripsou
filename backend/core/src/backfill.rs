//! Derive past holding values from transactions.
//!
//! Fills every (holding, day) that has no snapshot, walking quantity backward
//! from the nearest *later* snapshot — never from today, so drift stays inside
//! one gap. Days after the last snapshot get nothing: there is no later anchor
//! to walk from, and the sync stamps today anyway.
//!
//! quantity(d) is the anchor's quantity minus every movement strictly after d
//! up to and including the anchor day, which is one suffix sum per day.
//!
//! The whole connection is deleted and refilled on every run: simpler than an
//! incremental refill and cheap at this size.

use uuid::Uuid;

use crate::error::CoreError;

/// Rewrites the derived history for every holding on `connection_id`.
/// Returns the number of derived rows written.
pub async fn backfill_connection(
    conn: &mut sqlx::PgConnection,
    connection_id: Uuid,
) -> Result<u64, CoreError> {
    sqlx::query!(
        r#"
        delete from holding_backfill hb
        using holding h
        join account a on a.id = h.account_id
        where hb.holding_id = h.id and a.connection_id = $1
        "#,
        connection_id,
    )
    .execute(&mut *conn)
    .await?;

    let written = sqlx::query!(
        r#"
        insert into holding_backfill (holding_id, as_of, quantity, value)
        with scope as (
            select h.id as holding_id, h.account_id, h.instrument_id,
                   i.kind = 'cash' as is_cash,
                   -- Last-resort value for a holding no snapshot ever valued.
                   h.cost_basis as book_value,
                   i.currency = a.currency as is_account_currency,
                   -- Some connectors send a statement period as `booked_on`
                   -- (the 1st or the 16th). A row booked before it was spent
                   -- gives them away; such an account is keyed on `ts`.
                   not exists (
                       select 1 from transaction t
                       where t.account_id = a.id
                         and t.booked_on < (t.ts at time zone 'utc')::date
                   ) as trust_booked_on
            from holding h
            join account a    on a.id = h.account_id
            join instrument i on i.id = h.instrument_id
            where a.connection_id = $1
        ),
        -- One start day for all of the user's holdings, the day before their
        -- earliest evidence, so every account appears on the chart at the same
        -- date instead of each stepping net worth up when its history starts.
        owner as (
            select c.user_id from connection c where c.id = $1
        ),
        horizon as (
            select least(
                coalesce((select min(t.ts at time zone 'utc')::date from transaction t
                          join account a    on a.id = t.account_id
                          join connection c on c.id = a.connection_id
                          where c.user_id = (select user_id from owner)),
                         user_today((select user_id from owner))),
                coalesce((select min(hs.as_of) from holding_snapshot hs
                          join holding h    on h.id = hs.holding_id
                          join account a    on a.id = h.account_id
                          join connection c on c.id = a.connection_id
                          where c.user_id = (select user_id from owner)),
                         user_today((select user_id from owner))),
                coalesce((select min(l.acquired_on) from lot l
                          join holding h    on h.id = l.holding_id
                          join account a    on a.id = h.account_id
                          join connection c on c.id = a.connection_id
                          where c.user_id = (select user_id from owner)),
                         user_today((select user_id from owner)))
            ) - 1 as start_day
        ),
        -- Cash lines whose account has hand-entered rows before the provider's
        -- history starts, with that start day (see the lot branch of `moves`).
        prehistory as materialized (
            select s.holding_id, s.account_id, ps.day as provider_start
            from scope s
            cross join lateral (
                select min(txn_day(s.trust_booked_on, t.booked_on, t.ts)) as day
                from transaction t
                where t.account_id = s.account_id and t.external_id is not null
            ) ps
            where s.is_cash
              and s.is_account_currency
              and exists (
                  select 1 from transaction t
                  where t.account_id = s.account_id
                    and t.external_id is null
                    and txn_day(s.trust_booked_on, t.booked_on, t.ts) < ps.day
              )
        ),
        -- Signed movement per (holding, day). `materialized` matters: inlined,
        -- this aggregate runs once per derived row.
        moves as materialized (
          select holding_id, day, sum(delta) as delta from (
            -- Cash moves by amount, on the day the balance moved (`booked_on`),
            -- since the walk anchors on balances. `transaction` has no
            -- currency: `amount` is in the account's currency, so a cash line
            -- in another currency is held flat.
            select s.holding_id, txn_day(s.trust_booked_on, t.booked_on, t.ts) as day,
                   sum(t.amount) as delta
            from scope s
            join transaction t on t.account_id = s.account_id
            where s.is_cash
              and s.is_account_currency
            group by s.holding_id, txn_day(s.trust_booked_on, t.booked_on, t.ts)

            union all

            -- Before the provider's history, a lot has no provider row as its
            -- cash leg, so the lot moves the cash line itself. Only where the
            -- user also entered cash rows for that period: lots entered for
            -- cost basis alone would otherwise drain cash with no deposits to
            -- fund them.
            select p.holding_id, l.acquired_on as day,
                   sum(case when l.side = 'buy' then -(l.quantity * l.unit_price + l.fee)
                            else l.quantity * l.unit_price - l.fee end) as delta
            from prehistory p
            join holding h    on h.account_id = p.account_id
            join instrument i on i.id = h.instrument_id
            join account a    on a.id = p.account_id
            join lot l        on l.holding_id = h.id
            where i.kind <> 'cash'
              and i.currency = a.currency
              and l.acquired_on < p.provider_start
            group by p.holding_id, l.acquired_on

            union all

            -- Securities move by share count, from lots.
            select l.holding_id, l.acquired_on as day,
                   sum(case when l.side = 'buy' then l.quantity else -l.quantity end) as delta
            from scope s
            join lot l on l.holding_id = s.holding_id
            where not s.is_cash
            group by l.holding_id, l.acquired_on
          ) m
          group by holding_id, day
        ),
        days as (
            select s.holding_id, gs::date as as_of
            from scope s
            cross join horizon hz
            cross join lateral generate_series(
                hz.start_day, user_today((select user_id from owner)), '1 day') gs
        ),
        -- Every day a suffix sum is read at or summed over: snapshot days and
        -- movement days can lie after today, past the end of `days`.
        axis as materialized (
            select holding_id, as_of as day from days
            union
            select holding_id, day from moves
            union
            select hs.holding_id, hs.as_of
            from holding_snapshot hs
            join scope s on s.holding_id = hs.holding_id
        ),
        -- Σ delta over the days strictly after each day.
        moves_after as materialized (
            select a.holding_id, a.day,
                   coalesce(sum(m.delta) over (
                       partition by a.holding_id
                       order by a.day desc
                       groups between unbounded preceding and 1 preceding
                   ), 0) as total
            from axis a
            left join moves m on m.holding_id = a.holding_id and m.day = a.day
        ),
        -- Read off `moves_after` rather than joined to it: a CTE has no
        -- statistics, and the planner nested-looped that join.
        days_t as materialized (
            select ma.holding_id, ma.day as as_of, ma.total
            from moves_after ma
            cross join horizon hz
            where ma.day between hz.start_day and user_today((select user_id from owner))
        ),
        anchor_after as materialized (
            select ma.holding_id, ma.day, ma.total
            from moves_after ma
            join scope s on s.holding_id = ma.holding_id
            join holding_snapshot hs
              on hs.holding_id = ma.holding_id and hs.as_of = ma.day
        ),
        -- Days with no snapshot, each with the first snapshot after it.
        gaps as (
            select d.holding_id, d.as_of, d.total, nx.as_of as anchor_day,
                   nx.quantity as anchor_qty,
                   uv.quantity as unit_qty, uv.value as unit_value
            from days_t d
            join lateral (
                select hs.as_of, hs.quantity
                from holding_snapshot hs
                where hs.holding_id = d.holding_id and hs.as_of > d.as_of
                order by hs.as_of
                limit 1
            ) nx on true
            -- The per-unit value comes from the nearest snapshot that holds
            -- something, later first, then earlier: after a full sale every
            -- later snapshot is zero. Two seeks, because one ordering by
            -- distance can't use the index.
            left join lateral (
                select coalesce(nxt.quantity, prv.quantity) as quantity,
                       coalesce(nxt.value,    prv.value)    as value
                from (select 1) _one
                left join lateral (
                    select hs.quantity, hs.value
                    from holding_snapshot hs
                    where hs.holding_id = d.holding_id
                      and hs.quantity <> 0
                      and hs.as_of > d.as_of
                    order by hs.as_of
                    limit 1
                ) nxt on true
                left join lateral (
                    select hs.quantity, hs.value
                    from holding_snapshot hs
                    where hs.holding_id = d.holding_id
                      and hs.quantity <> 0
                      and hs.as_of <= d.as_of
                    order by hs.as_of desc
                    limit 1
                ) prv on true
            ) uv on true
            where not exists (
                select 1 from holding_snapshot hs
                where hs.holding_id = d.holding_id and hs.as_of = d.as_of
            )
        ),
        walked as (
            select g.holding_id, g.as_of, g.anchor_day, s.is_cash,
                   g.unit_qty, g.unit_value, s.book_value,
                   -- Σ(as_of, anchor_day] = Σ(> as_of) − Σ(> anchor_day).
                   g.anchor_qty - (g.total - aa.total) as quantity
            from gaps g
            join scope s on s.holding_id = g.holding_id
            join anchor_after aa
              on aa.holding_id = g.holding_id and aa.day = g.anchor_day
        ),
        -- A row missing from the ledger shifts a whole stretch by a constant,
        -- which can push it below zero. Each stretch (days sharing an anchor)
        -- is raised by its own shortfall, keeping its shape.
        lifted as (
            select w.*,
                   greatest(0, -min(w.quantity) over (
                       partition by w.holding_id, w.anchor_day
                   )) as lift
            from walked w
        )
        select w.holding_id, w.as_of, w.quantity + w.lift,
               -- `value` is only read for an instrument with no price. A
               -- security carries the nearest valued snapshot's per-unit value
               -- (multiplied first, so an unchanged quantity gives the
               -- snapshot's value exactly), else its book value: zero would
               -- dip the chart and raise fx_missing.
               case
                   when w.is_cash then w.quantity + w.lift
                   else coalesce(
                       (w.quantity + w.lift) * w.unit_value / nullif(w.unit_qty, 0),
                       w.book_value
                   )
               end
        from lifted w
        "#,
        connection_id,
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();

    Ok(written)
}
