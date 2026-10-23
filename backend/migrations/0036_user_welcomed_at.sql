-- When the user finished or skipped the welcome screen; null = not yet.
alter table users add column welcomed_at timestamptz;
update users set welcomed_at = now();
