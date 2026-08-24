-- valuation_grid used to generate its own daily series from (p_from, p_to).
-- Its callers now sample their day axis down to a roughly constant number of
-- points, and a grid that kept generating every day would both waste the work
-- and, worse, silently disagree with the caller's axis — the join is on
-- equality of `as_of`, so a mismatch reads zero rather than failing.
--
-- Taking the days as an array removes the hazard by construction: the caller
-- computes the list once and both sides unnest the same one.
--
-- Body is otherwise unchanged from 0018.
drop function if exists valuation_grid(uuid, date, date);

create function valuation_grid(p_user uuid, p_days date[])
returns table (as_of date, instrument_id uuid, kind text, currency text, unit_value numeric)
language sql
stable
-- The default estimate for a set-returning function is 1000 rows, which made
-- the planner nested-loop the callers' joins against it. One row per
-- instrument-day: a few hundred sampled days across a dozen instruments is
-- this order.
rows 10000
as $$
    with dates as (
        select distinct unnest(p_days) as as_of
    ),
    -- Every currency that can carry a rate: one per cash instrument, plus the
    -- pivot itself — whose rate is 1 whether or not anyone ever stored a cash
    -- instrument or a price for it, exactly as fx_asof answers.
    currencies as (
        select i.id, i.currency from instrument i where i.kind = 'cash'
        union all
        select null::uuid, s.base_currency
        from app_settings s
        where s.id = 1
          and not exists (
              select 1 from instrument i
              where i.kind = 'cash' and i.currency = s.base_currency
          )
    ),
    -- Last price on or before each day. `(as_of + 1)` at UTC midnight keeps the
    -- comparison on (instrument_id, ts) as a backwards seek and does not depend
    -- on the session TimeZone.
    fx as (
        select d.as_of, cu.currency, cu.id as instrument_id,
               case when cu.currency = (select base_currency from app_settings where id = 1)
                    then 1::numeric
                    else p.unit_price
               end as rate
        from dates d
        cross join currencies cu
        left join lateral (
            select p.unit_price
            from price p
            where p.instrument_id = cu.id
              and p.ts < ((d.as_of + 1)::timestamp at time zone 'UTC')
            order by p.ts desc
            limit 1
        ) p on true
    ),
    -- Only the securities this user holds. `instrument` is global across users,
    -- so scanning all of it would make one user's dashboard pay for everybody's
    -- holdings.
    held as (
        select distinct i.id, i.kind, i.currency
        from instrument i
        join holding h    on h.instrument_id = i.id
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where c.user_id = p_user and i.kind <> 'cash'
    ),
    lp as (
        select d.as_of, i.id, i.kind, i.currency, p.unit_price,
               p.currency as price_currency
        from dates d
        cross join held i
        left join lateral (
            select p.unit_price, p.currency
            from price p
            where p.instrument_id = i.id
              and p.ts < ((d.as_of + 1)::timestamp at time zone 'UTC')
            order by p.ts desc
            limit 1
        ) p on true
    )
    -- Securities: the price converted from the *price row's* currency, never
    -- the instrument's. Cash: the rate is the unit value, and the row exists
    -- even for a currency with no cash instrument (instrument_id then NULL,
    -- which no holding can join to anyway) so callers can still read a rate.
    select lp.as_of, lp.id, lp.kind, lp.currency, lp.unit_price * quote.rate
    from lp
    left join fx quote on quote.as_of = lp.as_of and quote.currency = lp.price_currency
    union all
    select fx.as_of, fx.instrument_id, 'cash', fx.currency, fx.rate
    from fx
$$;
