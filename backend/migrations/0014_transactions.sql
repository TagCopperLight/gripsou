-- Trigram search over transaction descriptions.
create extension if not exists "pg_trgm";

alter table transaction add column description text;

create index transaction_account_ts_idx on transaction (account_id, ts desc);
create index transaction_description_trgm_idx
    on transaction using gin (description gin_trgm_ops);

-- History derived from transactions for the days without a real snapshot.
create table holding_backfill (
    holding_id uuid    not null references holding (id) on delete cascade,
    as_of      date    not null,
    quantity   numeric not null,
    value      numeric not null,
    cost_basis numeric not null,
    primary key (holding_id, as_of)
);

-- No backfill row exists for a day that has a snapshot, so this union has one row per day.
create view holding_point as
    select holding_id, as_of, quantity, value, cost_basis from holding_snapshot
    union all
    select holding_id, as_of, quantity, value, cost_basis from holding_backfill;
