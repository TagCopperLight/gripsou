-- The settings the server reads are columns, each with its one default. The
-- display-only preferences stay in `prefs`.
alter table users
    add column currency            text     not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
    add column time_zone           text     not null default 'Europe/Paris',
    add column budget_ai_enabled   boolean  not null default false,
    add column budget_ai_threshold smallint not null default 70 check (budget_ai_threshold between 50 and 95);

update users
set currency = case when upper(prefs->>'currency') ~ '^[A-Z]{3}$'
                    then upper(prefs->>'currency') else 'EUR' end,
    time_zone = coalesce(prefs->>'timeZone', 'Europe/Paris'),
    budget_ai_enabled = coalesce((prefs->>'budgetAiEnabled')::boolean, false),
    budget_ai_threshold = least(greatest(coalesce((prefs->>'budgetAiThreshold')::int, 70), 50), 95),
    prefs = prefs - 'currency' - 'currencySymbol' - 'timeZone' - 'budgetAiEnabled' - 'budgetAiThreshold';

create or replace function reporting_fx_asof(p_user uuid, p_day date)
returns numeric
language sql
stable
as $$
    select coalesce(nullif(fx_asof((select currency from users where id = p_user), p_day), 0), 1)
$$;

create or replace function reporting_fx_degraded(p_user uuid, p_day date)
returns boolean
language sql
stable
as $$
    select nullif(fx_asof((select currency from users where id = p_user), p_day), 0) is null
$$;

create or replace function user_today(p_user uuid, p_now timestamptz default now())
returns date
language sql stable
as $$
    select (p_now at time zone (select time_zone from users where id = p_user))::date
$$;
