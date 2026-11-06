-- `holding_day_values` is planned on every call with the days it is given.
-- Inlined into a caller's prepared statement, its plan is cached: after five
-- runs Postgres switches to a generic plan, which cannot see how many days the
-- array holds, guesses ten, and nested-loops the rate grids (which have no
-- index), rescanning them once per holding-day. A plpgsql body under
-- `force_custom_plan` keeps the plan built from the real array.
--
-- The grids and the basis are `materialized`: inlined, each would be
-- re-executed per outer row.
create or replace function holding_day_values(p_user uuid, p_days date[])
returns table (holding_id uuid, account_id uuid, as_of date, value numeric, invested numeric,
               account_rate numeric, reporting_rate numeric, fx_missing boolean)
language plpgsql
stable
rows 10000
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
    return query
    with grid as materialized (
        select * from valuation_grid(p_user, p_days)
    ),
    fx as materialized (
        select g.as_of, g.currency, g.unit_value from grid g where g.kind = 'cash'
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
    select h.id, a.id, d.as_of, v.value, v.invested, afx.unit_value, rfx.unit_value, v.fx_missing
    from (select distinct unnest(p_days) as as_of) d
    cross join holding h
    join account a    on a.id = h.account_id
    join connection c on c.id = a.connection_id
    join grid uv      on uv.instrument_id = h.instrument_id and uv.as_of = d.as_of
    left join fx afx  on afx.as_of = d.as_of and afx.currency = a.currency
    left join fx rfx  on rfx.as_of = d.as_of
                     and rfx.currency = (select u.currency from users u where u.id = p_user)
    left join lb      on lb.holding_id = h.id and lb.as_of = d.as_of
    join lateral (
        select hp.quantity, hp.value
        from holding_point hp
        where hp.holding_id = h.id and hp.as_of <= d.as_of
        order by hp.as_of desc
        limit 1
    ) snap on true
    cross join lateral holding_valuation(
        snap.quantity, uv.unit_value, snap.value, lb.basis, afx.unit_value, rfx.unit_value
    ) v
    where c.user_id = p_user;
end
$$;
