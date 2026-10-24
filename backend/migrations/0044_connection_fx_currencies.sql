-- Every currency a connection converts through, the pivot excepted: each needs
-- a cash instrument whose prices are its FX rate, or whatever it governs reads
-- zero. One arm per way a currency enters a figure:
--   * the quote currency of a held instrument (a USD equity in a EUR account
--     never holds USD cash);
--   * the currency of a held instrument's price rows (Powens labels a listing
--     EUR, Yahoo quotes it in GBP, and the price row's currency is the one
--     converted from);
--   * the account currency, which cost basis and snapshot values are in;
--   * the owner's reporting currency, only ever a divisor.
-- The format check keeps a provider's stray "usd" from becoming a second,
-- shared cash instrument and from reaching a Yahoo URL.
create function connection_fx_currencies(p_connection uuid)
returns setof text
language sql
stable
as $$
    select cur
    from (
        select i.currency as cur
        from holding h
        join account a    on a.id = h.account_id
        join instrument i on i.id = h.instrument_id
        where a.connection_id = p_connection and h.quantity <> 0

        union

        select p.currency
        from holding h
        join account a on a.id = h.account_id
        join price p   on p.instrument_id = h.instrument_id
        where a.connection_id = p_connection and h.quantity <> 0

        union

        select a.currency
        from account a
        where a.connection_id = p_connection

        union

        select u.currency
        from connection c
        join users u on u.id = c.user_id
        where c.id = p_connection
    ) needed
    where cur <> (select base_currency from app_settings where id = 1)
      and cur ~ '^[A-Z]{3}$'
$$;
