-- Resolve the cash instrument first, so the price lookup is an index seek.
create or replace function fx_asof(p_currency text, p_day date)
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
            where p.instrument_id = (
                    select i.id
                    from instrument i
                    where i.kind = 'cash' and i.currency = p_currency
                  )
              and p.ts < ((p_day + 1)::timestamp at time zone 'UTC')
            order by p.ts desc
            limit 1
        )
    end
$$;
