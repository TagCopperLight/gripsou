-- Saved application logs. `fields` holds the event's fields merged over those
-- of its enclosing spans, plus `spans`. No foreign keys: a line outlives the
-- user or connection it is about.
create table log (
    id      bigint generated always as identity primary key,
    at      timestamptz not null,
    level   text not null check (level in ('error', 'warn', 'info')),
    target  text not null,
    message text not null,
    fields  jsonb not null default '{}'
);

create index log_at_idx on log (at);
