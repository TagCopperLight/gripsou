-- Price rows are one-per-day observations, but they were stored at whatever
-- timestamp Yahoo stamped the bar with: the exchange's open (07:00 UTC for
-- Paris) for a settled bar, and the wall-clock moment of the request for the
-- in-progress candle emitted while the market is open.
--
-- That produced two rows for one day, and made max(ts) land mid-afternoon —
-- which the price-sync pass used as the point to resume fetching from, so the
-- days around it could never be re-requested. See core/src/price_sync.rs
-- (REFETCH_DAYS) and providers/src/yahoo/map.rs, which now snap incoming bars
-- to UTC midnight. This aligns the history already stored to the same grid.

-- Keep the earliest row of each day: for a day that has both, that is the
-- open-stamped settled bar rather than the mid-session candle.
delete from price a
using price b
where a.instrument_id = b.instrument_id
  and (a.ts at time zone 'UTC')::date = (b.ts at time zone 'UTC')::date
  and a.ts > b.ts;

update price
set ts = ((ts at time zone 'UTC')::date)::timestamp at time zone 'UTC'
where ts <> ((ts at time zone 'UTC')::date)::timestamp at time zone 'UTC';
