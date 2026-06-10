-- gripsou initial schema (ARCHITECTURE §3.2).
-- Domain-first; providers map into this. Money is NUMERIC, time is timestamptz,
-- provider extras live in *_meta JSONB, external_id enables idempotent upserts.

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ── Identity & access ───────────────────────────────────────────────────────

create table users (
    id            uuid primary key default gen_random_uuid(),
    email         text not null unique,
    name          text not null,
    password_hash text not null,
    role          text not null default 'user' check (role in ('admin', 'user')),
    prefs         jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);

create table invite_token (
    id         uuid primary key default gen_random_uuid(),
    token      text not null unique,
    type       text not null check (type in ('invite', 'reset')),
    email      text,
    created_by uuid not null references users (id) on delete cascade,
    expires_at timestamptz not null,
    used_at    timestamptz
);

create table app_settings (
    id                smallint primary key default 1 check (id = 1),
    cors_origins      text[] not null default '{}',
    enabled_providers text[] not null default '{}',
    base_currency     text
);

create table provider (
    key          text primary key,
    display_name text not null,
    kind         text not null check (kind in ('account', 'price')),
    enabled      boolean not null default true
);

-- ── Reference (extensible by data insert, never migration) ──────────────────

create table category (
    key   text primary key,
    label text not null
);

create table account_type (
    key          text primary key,
    label        text not null,
    category_key text not null references category (key)
);

-- ── Connections & accounts ──────────────────────────────────────────────────

create table connection (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references users (id) on delete cascade,
    provider_key  text not null references provider (key),
    display_name  text not null,
    status        text not null default 'ok' check (status in ('ok', 'syncing', 'error')),
    last_sync_at  timestamptz,
    last_error    text,
    credentials   jsonb not null default '{}'::jsonb,  -- encrypted at rest
    provider_meta jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);

create table account (
    id            uuid primary key default gen_random_uuid(),
    connection_id uuid references connection (id) on delete cascade,  -- null = manual (future)
    name          text not null,
    color         text,
    currency      text not null,
    type_key      text not null references account_type (key),
    provider_meta jsonb not null default '{}'::jsonb,
    external_id   text,
    created_at    timestamptz not null default now()
);

-- ── Positions & instruments (instrument/price are global) ───────────────────

create table instrument (
    id       uuid primary key default gen_random_uuid(),
    kind     text not null,  -- cash | equity | etf | crypto | …
    symbol   text,
    isin     text,
    name     text not null,
    logo_url text,
    currency text not null,
    meta     jsonb not null default '{}'::jsonb
);
-- one cash instrument per currency; natural-id uniqueness for the rest
create unique index instrument_cash_currency_uq
    on instrument (currency) where kind = 'cash';
create unique index instrument_isin_uq
    on instrument (isin) where isin is not null;
create unique index instrument_kind_symbol_uq
    on instrument (kind, symbol) where symbol is not null;

create table holding (
    id            uuid primary key default gen_random_uuid(),
    account_id    uuid not null references account (id) on delete cascade,
    instrument_id uuid not null references instrument (id),
    quantity      numeric not null default 0,
    cost_basis    numeric not null default 0,
    updated_at    timestamptz not null default now(),
    unique (account_id, instrument_id)
);

create table holding_snapshot (
    id         uuid primary key default gen_random_uuid(),
    holding_id uuid not null references holding (id) on delete cascade,
    as_of      date not null,
    quantity   numeric not null,
    value      numeric not null,
    cost_basis numeric not null,
    unique (holding_id, as_of)
);

create table price (
    id            uuid primary key default gen_random_uuid(),
    instrument_id uuid not null references instrument (id) on delete cascade,
    ts            timestamptz not null,
    unit_price    numeric not null,
    currency      text not null,
    unique (instrument_id, ts)
);

-- ── Activity ────────────────────────────────────────────────────────────────

create table transaction (
    id            uuid primary key default gen_random_uuid(),
    account_id    uuid not null references account (id) on delete cascade,
    instrument_id uuid references instrument (id),  -- null = pure cash movement
    ts            timestamptz not null,
    type          text not null check (type in (
        'deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'interest', 'transfer'
    )),
    quantity      numeric,
    unit_price    numeric,
    amount        numeric not null,
    fee           numeric,
    external_id   text,
    provider_meta jsonb not null default '{}'::jsonb
);
