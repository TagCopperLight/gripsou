-- fx_asof could not seek its own index, which is what made the dashboard slow.
--
-- The previous body joined `price` to `instrument` and filtered on
-- (kind, currency). `instrument_id` was therefore not a constant, so the planner
-- could not walk `price_instrument_id_ts_key` backwards to the first matching
-- row: it bitmap-scanned every price row for that currency and then top-N
-- sorted. With 5,838 CNY price rows that is ~2 ms per call, and the dashboard
-- calls this once per (holding × day) — plus once more inside unit_value_asof,
-- which multiplies every price by fx_asof of the *price row's* currency.
--
-- Resolving the instrument in a scalar subquery first makes instrument_id a
-- constant, so the index scan becomes a seek + limit 1.
-- `instrument_cash_currency_uq` (unique on currency where kind = 'cash')
-- guarantees the subquery yields at most one row, so this is a pure rewrite:
-- same result, same NULL behaviour when no rate exists.
--
-- Measured on the production database, 184 days:
--   184 fx_asof('CNY', …) calls   130.8 ms  ->   3.5 ms
--   full net-worth series query   561    ms  ->  13.6 ms
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
