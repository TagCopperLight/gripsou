-- Each connection belongs to exactly one institution (bank/broker). Both columns
-- are filled on the first successful sync; null until then (connections sit in
-- 'pending'/'awaiting' before that). institution_key is the provider's raw value;
-- connection.provider_key namespaces it.
alter table connection
    add column institution_key  text,
    add column institution_name text;
