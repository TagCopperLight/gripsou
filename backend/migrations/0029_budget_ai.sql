-- Phase 5: server-wide AI provider choice, and the per-user run lock.
-- The API keys are NOT here: they live in `.env` (GEMINI_API_KEY, JEV_API_KEY),
-- per the project's config split — secrets via env, admin-tunable values in
-- app_settings. A null provider means the AI is off for the whole instance.

alter table app_settings
    add column budget_ai_provider text check (budget_ai_provider in ('gemini', 'jev')),
    add column budget_ai_model    text;

-- One row while a categorisation run holds a user. Claimed with
-- `insert ... on conflict do nothing`; swept at boot, because the app is
-- single-process and any row found then belongs to a dead run.
create table budget_ai_lock (
    user_id    uuid primary key references users (id) on delete cascade,
    started_at timestamptz not null default now()
);
