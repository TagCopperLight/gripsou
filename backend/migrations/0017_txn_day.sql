-- Which day a transaction moved the balance, for the backward walk.
--
-- Normally that is `booked_on`. But some connectors do not send a booking date
-- at all: they send the *statement period* every row landed in, stamping a
-- fortnight of movements onto the 1st or the 16th. Keying the walk on that
-- collapses them onto one day and craters the days just before it. Callers
-- decide per account whether the date is real (see backfill.rs) and pass the
-- verdict in; this only applies it, in one place, for every call site.
create function txn_day(trust boolean, booked date, ts timestamptz)
    returns date
    language sql
    immutable
as $$
    select case
        when trust then coalesce(booked, (ts at time zone 'utc')::date)
        else (ts at time zone 'utc')::date
    end
$$;
