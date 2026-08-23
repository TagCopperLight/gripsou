-- Transactions phase 1 (TRANSACTIONS.md §4).

-- Trigram search over transaction descriptions.
create extension if not exists "pg_trgm";

alter table transaction add column description text;

create index transaction_account_ts_idx on transaction (account_id, ts desc);
create index transaction_description_trgm_idx
    on transaction using gin (description gin_trgm_ops);

-- Derived history: values computed from transactions for days that have no
-- real snapshot. Mirrors holding_snapshot's columns on purpose so the two can
-- be unioned rather than reconciled.
create table holding_backfill (
    holding_id uuid    not null references holding (id) on delete cascade,
    as_of      date    not null,
    quantity   numeric not null,
    value      numeric not null,
    cost_basis numeric not null,
    primary key (holding_id, as_of)
);

-- The invariant (§4): no backfill row may exist for a day that has a snapshot.
-- stamp_snapshot enforces it on write, so this union is unambiguous and every
-- chart query can read `holding_point` exactly where it read `holding_snapshot`.
create view holding_point as
    select holding_id, as_of, quantity, value, cost_basis from holding_snapshot
    union all
    select holding_id, as_of, quantity, value, cost_basis from holding_backfill;
