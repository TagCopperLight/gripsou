-- An FX rate is a `price` row of a cash instrument: on instrument(kind='cash',
-- currency='CNY'), unit_price = 0.12 with currency = 'EUR' means "1 CNY is worth
-- 0.12 EUR". Rates are stored against the pivot, app_settings.base_currency.

update app_settings set base_currency = 'EUR' where base_currency is null;
alter table app_settings alter column base_currency set default 'EUR';
alter table app_settings alter column base_currency set not null;

-- The currency preference becomes an ISO code instead of a symbol.
update users
set prefs = jsonb_set(prefs - 'currencySymbol', '{currency}', to_jsonb(
    case prefs->>'currencySymbol'
        when '€'   then 'EUR'
        when '$'   then 'USD'
        when '£'   then 'GBP'
        when 'CHF' then 'CHF'
        when '¥'   then 'JPY'
        else 'EUR'
    end
));

-- Value of one unit of `currency` in the pivot at the end of the day; NULL when unknown.
create function fx_asof(p_currency text, p_day date)
returns numeric
language sql
stable
as $$
    select case
        when p_currency = (select base_currency from app_settings where id = 1)
            then 1::numeric
        else (
            select p.unit_price
            from price p
            join instrument i on i.id = p.instrument_id
            where i.kind = 'cash'
              and i.currency = p_currency
              and p.ts < ((p_day + 1)::timestamp at time zone 'UTC')
            order by p.ts desc
            limit 1
        )
    end
$$;

-- An instrument's unit value in the pivot at the end of the day, or NULL if
-- unknown. The currency is the price row's, not the instrument's: a listing can
-- be quoted in another currency than the one the provider labelled.
create function unit_value_asof(p_instrument uuid, p_day date)
returns numeric
language sql
stable
as $$
    select case
        when i.kind = 'cash' then fx_asof(i.currency, p_day)
        else (
            select p.unit_price * fx_asof(p.currency, p_day)
            from price p
            where p.instrument_id = i.id
              and p.ts < ((p_day + 1)::timestamp at time zone 'UTC')
            order by p.ts desc
            limit 1
        )
    end
    from instrument i
    where i.id = p_instrument
$$;

-- Divisor from the pivot to the user's reporting currency; 1 when it has no rate.
create function reporting_fx_asof(p_user uuid, p_day date)
returns numeric
language sql
stable
as $$
    select coalesce(
        fx_asof(coalesce((select prefs->>'currency' from users where id = p_user), 'EUR'), p_day),
        1
    )
$$;

drop function price_asof(uuid, date);
