-- `transaction` is the cash ledger only. Delete the hand-entered buy/sell rows,
-- copied into `lot` by 0021, but refuse if one of them was not copied.
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

alter table transaction drop column instrument_id;
alter table transaction drop column quantity;
alter table transaction drop column unit_price;
