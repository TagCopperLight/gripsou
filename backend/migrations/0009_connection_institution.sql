-- The connection's bank or broker, as the provider names it. Null until the first sync.
alter table connection
    add column institution_key  text,
    add column institution_name text;
