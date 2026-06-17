create table session (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references users (id) on delete cascade,
    token_hash     bytea not null unique,
    user_agent     text,
    ip             text,
    remembered     boolean not null default false,
    created_at     timestamptz not null default now(),
    last_active_at timestamptz not null default now(),
    expires_at     timestamptz not null
);

create index session_user_id_idx on session (user_id);
