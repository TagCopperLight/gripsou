-- One valuation and conversion surface. A figure whose rate is unknown on its
-- day is left out and flagged, never shown in the pivot under the reader's
-- symbol: every conversion goes through `fx_convert`, and every holding is
-- valued by `holding_valuation`.

drop function reporting_fx_degraded(uuid, date);

-- `amount` from the currency whose pivot value is `from_rate` into the one
-- whose pivot value is `to_rate`. NULL when either rate is unknown; a
-- `to_rate` of 0 counts as unknown. Pass 1 as `from_rate` for a pivot amount.
create function fx_convert(p_amount numeric, p_from_rate numeric, p_to_rate numeric)
returns numeric
language sql
immutable
as $$
    select p_amount * p_from_rate / nullif(p_to_rate, 0)
$$;

-- Divisor from the pivot to the user's reporting currency; NULL when it has no rate.
create or replace function reporting_fx_asof(p_user uuid, p_day date)
returns numeric
language sql
stable
as $$
    select nullif(fx_asof((select currency from users where id = p_user), p_day), 0)
$$;

-- A lot's cash impact in the account's currency, fee included: a buy is
-- negative, a sale positive.
create function lot_cash_amount(p_side text, p_quantity numeric, p_unit_price numeric, p_fee numeric)
returns numeric
language sql
immutable
as $$
    select case when p_side = 'buy' then -(p_quantity * p_unit_price + p_fee)
                else p_quantity * p_unit_price - p_fee end
$$;

-- `fx_asof` for every (day, currency) at once, one index seek each: one row
-- per cash instrument, plus the pivot when it has none, whose rate is always
-- 1. NULL `p_currencies` means every currency.
create function fx_grid(p_days date[], p_currencies text[] default null)
returns table (as_of date, currency text, instrument_id uuid, rate numeric)
language sql
stable
-- The default estimate of 1000 rows makes the planner nested-loop the callers' joins.
rows 10000
as $$
    with dates as (
        select distinct unnest(p_days) as as_of
    ),
    currencies as (
        select i.id, i.currency
        from instrument i
        where i.kind = 'cash'
          and (p_currencies is null or i.currency = any(p_currencies))
        union all
        select null::uuid, s.base_currency
        from app_settings s
        where s.id = 1
          and (p_currencies is null or s.base_currency = any(p_currencies))
          and not exists (
              select 1 from instrument i
              where i.kind = 'cash' and i.currency = s.base_currency
          )
    )
    select d.as_of, cu.currency, cu.id,
           case when cu.currency = (select base_currency from app_settings where id = 1)
                then 1::numeric
                else p.unit_price
           end
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
$$;

create or replace function valuation_grid(p_user uuid, p_days date[])
returns table (as_of date, instrument_id uuid, kind text, currency text, unit_value numeric)
language sql
stable
rows 10000
as $$
    with fx as (
        select * from fx_grid(p_days)
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
        from (select distinct unnest(p_days) as as_of) d
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

-- The valuation rule for one holding on one day, in the pivot. Three currency
-- domains meet here and are never conflated: the unit value already folds in
-- the price row's currency; the provider's valuation and the basis are in the
-- account's currency, hence `p_account_rate`; the reporting rate only decides
-- whether the reader can be shown the figure. The instrument's own currency is
-- none of them: a USD-quoted stock in a EUR account has a EUR basis.
--
-- `value` is the price, else the provider's valuation, else zero; `invested`
-- the converted basis, else zero. `fx_missing` says a figure was left out: a
-- held position that could not be valued, a basis whose account currency has
-- no rate, or anything at all when the reader's currency has no rate. A sold
-- position raises nothing, so it leaves no permanent warning behind.
--
-- A set-returning function so a lateral call is inlined into the caller.
create function holding_valuation(
    p_quantity numeric, p_unit_value numeric, p_provider_value numeric,
    p_basis numeric, p_account_rate numeric, p_reporting_rate numeric)
returns table (value numeric, invested numeric, fx_missing boolean)
language sql
immutable
as $$
    select coalesce(p_quantity * p_unit_value, p_provider_value * p_account_rate, 0),
           coalesce(p_basis * p_account_rate, 0),
           coalesce(
               (p_quantity <> 0
                and p_unit_value is null
                and coalesce(p_provider_value * p_account_rate, 0) = 0)
               or (p_basis <> 0 and p_account_rate is null)
               or ((p_quantity <> 0 or p_basis <> 0) and nullif(p_reporting_rate, 0) is null),
               false)
$$;

-- Every holding of a user valued on each day asked, from its as-of point
-- (snapshot or backfill), in the pivot. A holding has no row before its first
-- point, so a position never counts before it was acquired. The rates are
-- returned so a caller sums in the pivot and converts once.
create function holding_day_values(p_user uuid, p_days date[])
returns table (holding_id uuid, account_id uuid, as_of date, value numeric, invested numeric,
               account_rate numeric, reporting_rate numeric, fx_missing boolean)
language sql
stable
rows 10000
as $$
    -- `materialized` is load-bearing on all of these: inlined, each would be
    -- re-executed per outer row.
    with grid as materialized (
        select * from valuation_grid(p_user, p_days)
    ),
    fx as materialized (
        select g.as_of, g.currency, g.unit_value from grid g where g.kind = 'cash'
    ),
    -- The reporting rate rides on the day row: joined on its own, a generic
    -- plan expects one row and rescans it for every holding-day.
    dates as materialized (
        select d.as_of, r.unit_value as reporting_rate
        from (select distinct unnest(p_days) as as_of) d
        left join fx r
          on r.as_of = d.as_of
         and r.currency = (select u.currency from users u where u.id = p_user)
    ),
    lb as materialized (
        select * from lot_basis(
            array(
                select h.id
                from holding h
                join account a    on a.id = h.account_id
                join connection c on c.id = a.connection_id
                where c.user_id = p_user
            ),
            p_days
        )
    )
    select h.id, a.id, d.as_of, v.value, v.invested, afx.unit_value, d.reporting_rate, v.fx_missing
    from dates d
    cross join holding h
    join account a    on a.id = h.account_id
    join connection c on c.id = a.connection_id
    join grid uv      on uv.instrument_id = h.instrument_id and uv.as_of = d.as_of
    left join fx afx  on afx.as_of = d.as_of and afx.currency = a.currency
    left join lb      on lb.holding_id = h.id and lb.as_of = d.as_of
    -- No day carries both a snapshot and a backfill row (stamping deletes
    -- the backfill), so the union needs no precedence rule.
    join lateral (
        select hp.quantity, hp.value
        from holding_point hp
        where hp.holding_id = h.id and hp.as_of <= d.as_of
        order by hp.as_of desc
        limit 1
    ) snap on true
    cross join lateral holding_valuation(
        snap.quantity, uv.unit_value, snap.value, lb.basis, afx.unit_value, d.reporting_rate
    ) v
    where c.user_id = p_user
$$;

create or replace function budget_transaction_rows(p_user uuid, p_threshold numeric)
returns setof budget_transaction_row
language sql stable as $$
    select t.id, t.spent_on, t.type, t.description, t.amount,
           'cash'::text, null::text, null::numeric, null::numeric, null::numeric,
           a.id, a.name, a.color, a.currency,
           t.budget_category_id, bc.name, bc.default_key, bc.color, bc.icon, bc.kind,
           t.category_source, t.category_confidence,
           coalesce(budget_needs_review(t.category_source, t.category_reviewed_at,
                                        t.category_confidence, bc.kind, p_threshold), false),
           t.checked_at is not null,
           t.transfer_pair_id is not null,
           coalesce(t.category_source = 'pair' and t.transfer_pair_id is null, false),
           coalesce(bc.system_key = 'internal_transfer', false),
           null::text, null::text, null::text
    from transaction t
    join account a    on a.id = t.account_id
    join connection c on c.id = a.connection_id
    left join budget_category bc on bc.id = t.budget_category_id
    where c.user_id = p_user
      and not budget_investment_leg(t.type)

    union all

    select l.id, l.acquired_on, l.side, null::text,
           lot_cash_amount(l.side, l.quantity, l.unit_price, l.fee),
           'lot'::text,
           coalesce(i.symbol, i.meta->>'yahoo_symbol', i.isin, i.name),
           l.quantity, l.unit_price, l.fee,
           a.id, a.name, a.color, a.currency,
           null::uuid, null::text, null::text, null::text, null::text, null::text,
           null::text, null::numeric, false, false, false, false, false,
           i.kind, i.isin, i.symbol
    from lot l
    join holding h    on h.id = l.holding_id
    join instrument i on i.id = h.instrument_id
    join account a    on a.id = h.account_id
    join connection c on c.id = a.connection_id
    where c.user_id = p_user
$$;
