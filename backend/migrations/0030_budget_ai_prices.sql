-- USD per million tokens, keyed by model: `{ "<model>": { "in": "0.10", "out": "0.40" } }`.
alter table app_settings
    add column budget_ai_prices jsonb not null default '{}'::jsonb;
