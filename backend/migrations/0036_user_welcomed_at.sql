-- When the user finished or skipped the welcome screen shown after redeeming
-- an invite. Null = not yet. Accounts that existed before the screen never see it.
alter table users add column welcomed_at timestamptz;
update users set welcomed_at = now();
