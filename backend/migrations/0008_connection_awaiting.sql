-- 'awaiting': a refresh was requested from the provider, waiting for its webhook.
alter table connection drop constraint connection_status_check;
alter table connection add constraint connection_status_check
    check (status in ('pending', 'ok', 'syncing', 'error', 'awaiting'));
alter table connection add column sync_requested_at timestamptz;
