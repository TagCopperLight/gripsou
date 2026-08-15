-- Multi-currency valuation. An FX rate is a `price` row on the per-currency
-- cash instrument: a row on instrument(kind='cash', currency='CNY') with
-- unit_price = 0.12 and currency = 'EUR' means "1 CNY is worth 0.12 EUR".
-- The pivot currency (app_settings.base_currency) is what rates are stored
-- against; it is never displayed — every figure is divided into the reading
-- user's own reporting currency by reporting_fx_asof().

-- The pivot must always exist.
update app_settings set base_currency = 'EUR' where base_currency is null;
alter table app_settings alter column base_currency set default 'EUR';
alter table app_settings alter column base_currency set not null;

-- Promote the per-user currency preference from a bare symbol ('€') to an ISO
-- code ('EUR'). The symbol is derived on the frontend from the code, which also
-- resolves '¥' being ambiguous between JPY and CNY (it maps to JPY, matching
-- the label the old picker showed).
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

-- Rate for one unit of `currency`, expressed in the pivot, as of end of day.
-- 1 for the pivot itself (there is no EUREUR=X to fetch, and an all-pivot
-- install needs no FX data at all). NULL when no rate is known — callers treat
-- that as "value at zero and flag it", never as 1.
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

-- An instrument's unit value in the pivot as of end of day, or NULL if unknown.
-- Supersedes price_asof: it reads the currency off the *price row*, not the
-- instrument, so a Yahoo listing quoted in USD correctly values an instrument
-- Powens labelled EUR. Cash instruments have no unit price of their own — their
-- unit value simply is the FX rate.
--
-- `(p_day + 1)::timestamp at time zone 'UTC'` is next-day UTC midnight, so the
-- comparison stays on the (instrument_id, ts) index and does not depend on the
-- session TimeZone.
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

-- Divisor that turns a pivot-denominated figure into the user's reporting
-- currency. Falls back to 1 (report in the pivot) when the user's own currency
-- has no rate, rather than collapsing the whole row to NULL; the fx_missing
-- flag on the same query tells the UI to say so.
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
