-- Admin-entered AI prices, USD per million tokens, keyed by the run log's
-- `budget_ai_run.model` (e.g. `gemini:gemini-3.5-flash-lite`). Values are
-- decimal strings, never JSON numbers: `{ "<model>": { "in": "0.10", "out": "0.40" } }`.
alter table app_settings
    add column budget_ai_prices jsonb not null default '{}'::jsonb;
