-- Whether an account's booking dates are the days its balance moved. Some
-- connectors send a statement period as `booked_on` (the 1st or the 16th) and
-- give themselves away with a row booked before it was spent; such an
-- account's rows move the balance on their spend day. Pass it to `txn_day`.
create function account_trusts_booked_on(p_account uuid)
    returns boolean
    language sql
    stable
as $$
    select not exists (
        select 1 from transaction t
        where t.account_id = p_account
          and t.booked_on < t.spent_on
    )
$$;
