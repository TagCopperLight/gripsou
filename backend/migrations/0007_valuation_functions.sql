-- Shared valuation primitive: an instrument's unit price as of the end of a
-- given day, or NULL if it has no price on/before that day. Centralises the
-- price-lookup so the net-worth and per-account series can't diverge, and so
-- the day boundary is computed once, in UTC.
--
-- `(p_day + 1)::timestamp at time zone 'UTC'` is next-day UTC midnight, so the
-- comparison stays on the (instrument_id, ts) index (no functional cast of the
-- indexed column) and does not depend on the session TimeZone.
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
