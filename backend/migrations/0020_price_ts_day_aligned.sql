-- One price row per day, stamped at UTC midnight. Of two rows on one day, keep
-- the earliest: the settled bar rather than an intraday candle.
delete from price a
using price b
where a.instrument_id = b.instrument_id
  and (a.ts at time zone 'UTC')::date = (b.ts at time zone 'UTC')::date
  and a.ts > b.ts;

update price
set ts = ((ts at time zone 'UTC')::date)::timestamp at time zone 'UTC'
where ts <> ((ts at time zone 'UTC')::date)::timestamp at time zone 'UTC';
