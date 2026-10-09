-- Saved application logs: every info-and-above line from gripsou's own
-- crates, written in batches by the in-process log writer, kept 90 days
-- (deleted by the scheduler's daily `logs` sweep).
--
-- `fields` holds the event's structured fields merged over those of every
-- enclosing span (innermost wins), plus `spans`: the span names, outermost
-- first. No foreign keys on purpose: a line about a deleted user or
-- connection must outlive it until it ages out.
--
-- Sync history is read from here: one `sync finished` line per sync, see
-- CLAUDE.md "Logs".
create table log (
    id      bigint generated always as identity primary key,
    at      timestamptz not null,
    level   text not null check (level in ('error', 'warn', 'info')),
    target  text not null,
    message text not null,
    fields  jsonb not null default '{}'
);

create index log_at_idx on log (at);
