-- A stored rate of 0 counts as no rate, instead of dividing by zero.
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
