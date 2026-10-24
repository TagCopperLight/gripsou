-- True when the reporting currency has no usable rate and figures fall back to the pivot.
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
