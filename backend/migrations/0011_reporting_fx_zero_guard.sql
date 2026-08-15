-- Guard the reporting divisor against a zero rate.
--
-- reporting_fx_asof() is the divisor of every dashboard aggregate. A stored rate
-- of exactly 0 (a bad provider tick, a placeholder row) would raise
-- division_by_zero on net worth, accounts, the series and the pie all at once —
-- the whole dashboard 500s instead of degrading. nullif() turns that into "no
-- usable rate", which the existing coalesce already handles by reporting in the
-- pivot; the fx_missing flag on the same queries still tells the UI something is
-- off. A missing rate still values at zero and flags — that is unchanged, and is
-- decided by fx_asof(), not here.
create or replace function reporting_fx_asof(p_user uuid, p_day date)
returns numeric
language sql
stable
as $$
    select coalesce(
        nullif(
            fx_asof(coalesce((select prefs->>'currency' from users where id = p_user), 'EUR'), p_day),
            0
        ),
        1
    )
$$;
