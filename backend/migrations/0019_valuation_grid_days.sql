-- The caller passes its day axis, so both sides join on the same days.
drop function if exists valuation_grid(uuid, date, date);

create function valuation_grid(p_user uuid, p_days date[])
returns table (as_of date, instrument_id uuid, kind text, currency text, unit_value numeric)
language sql
stable
-- The default estimate of 1000 rows makes the planner nested-loop the callers' joins.
rows 10000
as $$
    with dates as (
        select distinct unnest(p_days) as as_of
    ),
    -- One per cash instrument, plus the pivot, whose rate is always 1.
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
    -- Last price on or before each day.
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
    -- Only this user's securities: `instrument` is shared by all users.
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
    -- A security's price is converted from the price row's currency. A cash
    -- instrument's unit value is its rate.
    select lp.as_of, lp.id, lp.kind, lp.currency, lp.unit_price * quote.rate
    from lp
    left join fx quote on quote.as_of = lp.as_of and quote.currency = lp.price_currency
    union all
    select fx.as_of, fx.instrument_id, 'cash', fx.currency, fx.rate
    from fx
$$;
