create function price_asof(p_instrument uuid, p_day date)
returns numeric
language sql
stable
as $$
    select unit_price
    from price
    where instrument_id = p_instrument
      and ts < ((p_day + 1)::timestamp at time zone 'UTC')
    order by ts desc
    limit 1
$$;
