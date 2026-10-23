-- The user's current calendar day.
create function user_today(p_user uuid, p_now timestamptz default now())
returns date
language sql stable
as $$
    select (p_now at time zone coalesce(
        (select prefs->>'timeZone' from users where id = p_user),
        'Europe/Paris'
    ))::date
$$;
