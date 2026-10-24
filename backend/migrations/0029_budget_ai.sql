-- The instance's AI provider and model (null: AI off), the run lock and the run log.

alter table app_settings
    add column budget_ai_provider text,
    add column budget_ai_model    text;

create table budget_ai_lock (
    user_id      uuid primary key references users (id) on delete cascade,
    heartbeat_at timestamptz not null default now()
);

create table budget_ai_run (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references users (id) on delete cascade,
    started_at     timestamptz not null default now(),
    model          text not null,
    tokens_in      bigint not null default 0,
    tokens_out     bigint not null default 0,
    -- False once a call did not report its token counts.
    usage_complete boolean not null default true,
    outcome        text not null default 'running'
                   check (outcome in ('running', 'ok', 'partial', 'error')),
    error          text
);

create index budget_ai_run_user_idx on budget_ai_run (user_id, started_at desc);

-- Stored so lookups by normalised description can use an index.
alter table transaction
    add column description_norm text
        generated always as (budget_norm_description(description)) stored;

create index transaction_description_norm_idx on transaction (description_norm);
create index transaction_description_norm_trgm_idx
    on transaction using gin (description_norm gin_trgm_ops);
