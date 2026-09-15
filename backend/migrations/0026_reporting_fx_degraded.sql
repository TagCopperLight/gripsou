-- Say out loud when the reporting currency has no rate.
--
-- reporting_fx_asof() falls back to 1 when the reader's prefs.currency has no
-- stored rate, which means "report in the pivot". That degradation is the right
-- behaviour (better than collapsing every figure to NULL), but until now nothing
-- told the UI it had happened: a EUR install whose owner picks USD in Settings
-- gets every euro figure relabelled with a dollar sign, silently, because the
-- existing fx_missing flag is computed from the user's *holdings* and never from
-- the reporting divisor.
--
-- This predicate is the flag. It mirrors reporting_fx_asof()'s own guard exactly
-- — same currency resolution, same nullif(…, 0) treatment of a zero rate — so
-- the two can never disagree about whether the fallback fired. The pivot itself
-- answers 1 from fx_asof, so an all-pivot install is never flagged.
create function reporting_fx_degraded(p_user uuid, p_day date)
returns boolean
language sql
stable
as $$
    select coalesce(
        nullif(
            fx_asof(
                coalesce(
                    (select prefs->>'currency' from users where id = p_user),
                    (select base_currency from app_settings where id = 1)
                ),
                p_day
            ),
            0
        ),
        0
    ) = 0
$$;
