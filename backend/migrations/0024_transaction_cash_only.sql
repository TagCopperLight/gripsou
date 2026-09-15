-- `transaction` is the cash ledger and nothing else. A purchase used to be one
-- row doing two jobs — the cash movement AND the investment record — which is
-- why it could not carry a fee and why the basis rule ended up in four places.
--
-- The hand-entered rows were copied into `lot` by 0021; delete them here so
-- nothing is counted twice. Provider rows stay: Powens' `ACHAT COMPTANT` lines
-- are real cash that really left the account.
--
-- Fail fast rather than lose data. 0021 copies only the manual buy/sell rows
-- that have BOTH a quantity and a unit price AND a matching holding; the delete
-- below is unconditional. A row that failed 0021's filter would therefore be
-- destroyed without ever having been copied, and the column drops after it are
-- irreversible. Every row qualifies in the database this was developed against,
-- so this guard should never fire — but it is the difference between a failed
-- deploy and a silently lost purchase on someone else's instance.
do $$
declare
    orphans int;
begin
    select count(*) into orphans
    from transaction t
    where t.external_id is null
      and t.type in ('buy', 'sell')
      and not exists (
          select 1
          from lot l
          join holding h on h.id = l.holding_id
          where h.account_id = t.account_id
            and h.instrument_id = t.instrument_id
            and l.source = 'manual'
            and l.side = t.type
            and l.acquired_on = (t.ts at time zone 'utc')::date
            and l.quantity = t.quantity
            and l.unit_price = t.unit_price
      );
    if orphans > 0 then
        raise exception
            'refusing to delete % manual buy/sell transaction(s) that migration 0021 did not copy into lot: they are missing a quantity, a unit price, or a matching holding. Delete or complete the offending rows, then re-run this migration.',
            orphans;
    end if;
end $$;

delete from transaction where external_id is null and type in ('buy', 'sell');

-- Verified before writing this migration: no provider row anywhere carries a
-- quantity, unit price or instrument — Powens sends none of the three (no
-- /marketorders, no instrument link on transactions). After the delete above
-- these three columns have no writer and no data.
alter table transaction drop column instrument_id;
alter table transaction drop column quantity;
alter table transaction drop column unit_price;
