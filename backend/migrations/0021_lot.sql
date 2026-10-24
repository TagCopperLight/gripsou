-- A purchase or sale, separate from the cash ledger. `quantity` is always
-- positive; `side` carries the direction. `source` says who wrote the row,
-- `external_id` dedups provider rows.
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

-- Hand-entered buy/sell transactions (null external_id) become manual lots.
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
