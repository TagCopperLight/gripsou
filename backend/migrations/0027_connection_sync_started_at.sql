-- When the current sync claimed the connection.
alter table connection add column sync_started_at timestamptz;
