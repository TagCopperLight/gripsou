-- A purchase or sale as a first-class record, separate from the cash ledger.
--
-- Until now a buy `transaction` did two jobs at once: it was the cash movement
-- AND the investment record. That is why it could not carry a fee, and why the
-- cost-basis rule ended up reimplemented in four places (AUDIT.md D-1, Z-1, C-7).
--
-- `holding_id` rather than (account_id, instrument_id): `holding` already has a
-- unique constraint on that pair and is never deleted (the sync's close loop
-- zeroes the quantity instead), so this is the same key with a foreign key
-- behind it, and it matches how holding_snapshot/holding_backfill address
-- holdings.
--
-- `acquired_on` is a DATE. The backfill walks whole days, a purchase has no
-- meaningful time of day, and every existing row is stamped midnight UTC. It
-- also keeps lots clear of the session-timezone-dependent `ts::date` cast that
-- AUDIT.md C-9 is about, rather than inheriting it.
--
-- `quantity` is always positive; `side` carries the direction. Already the
-- convention for buy/sell rows.
--
-- `fee` is not-null-default-0, not nullable: a nullable fee means a coalesce at
-- every use site, which is exactly how one rule becomes five spellings.
--
-- `source` and `external_id` are not redundant. `source` is provenance and
-- permission — the delete path's whole security model is `source = 'manual'`.
-- `external_id` is dedup, and is what lets a future broker provider (one that
-- actually reports orders, which Powens does not) land without a migration.
-- Using `external_id is null` alone would conflate "the user typed it" with "a
-- provider sent it without a stable id", and the delete path treats the former
-- as permission to delete.
--
-- 'inferred' is deliberately NOT in the source check: nothing infers lots yet,
-- and the value gets added alongside the code that produces it.
create table lot (
    id          uuid primary key default gen_random_uuid(),
    holding_id  uuid    not null references holding (id) on delete cascade,
    side        text    not null check (side in ('buy', 'sell')),
    acquired_on date    not null,
    quantity    numeric not null check (quantity > 0),
    unit_price  numeric not null check (unit_price >= 0),
    fee         numeric not null default 0 check (fee >= 0),
    source      text    not null check (source in ('manual', 'provider')),
    external_id text,
    meta        jsonb   not null default '{}',
    created_at  timestamptz not null default now()
);

create unique index lot_external_uq on lot (holding_id, external_id)
    where external_id is not null;
create index lot_holding_idx on lot (holding_id, acquired_on);

-- Move the user's hand-entered lots across. `external_id is null` is what
-- marked them user-entered under the old scheme (TRANSACTIONS.md §9.2), so it
-- is the correct filter here, and they all become source = 'manual'.
--
-- Provider buy rows (Powens' `ACHAT COMPTANT` cash lines) are NOT moved: they
-- carry no instrument, quantity or unit price, they are real cash, and they
-- stay in `transaction` where they belong.
--
-- `fee` defaults to 0. The real fees are only recoverable from broker
-- statements, which is data entry the user does afterwards.
insert into lot (holding_id, side, acquired_on, quantity, unit_price, fee, source)
select h.id,
       t.type,
       (t.ts at time zone 'utc')::date,
       t.quantity,
       t.unit_price,
       0,
       'manual'
from transaction t
join holding h on h.account_id = t.account_id
              and h.instrument_id = t.instrument_id
where t.external_id is null
  and t.type in ('buy', 'sell')
  and t.quantity is not null
  and t.unit_price is not null;
