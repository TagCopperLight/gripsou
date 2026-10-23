-- The day a transaction moved the balance. `trust` says whether the account's
-- booking dates are real: some connectors send the statement period instead.
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
