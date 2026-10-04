-- A user's current calendar day. Date-only provider data and global daily
-- prices keep their existing UTC-midnight encoding; only the current day
-- depends on the user. Existing snapshots lack capture timestamps and cannot
-- be safely reassigned, so their historical day labels are preserved.
create function user_today(p_user uuid, p_now timestamptz default now())
returns date
language sql stable
as $$
    select (p_now at time zone coalesce(
        (select prefs->>'timeZone' from users where id = p_user),
        'Europe/Paris'
    ))::date
$$;
