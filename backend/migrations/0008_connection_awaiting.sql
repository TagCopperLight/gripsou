-- Webhook-driven sync: 'awaiting' = force-refresh requested, waiting for the
-- provider's webhook (or the reaper timeout). sync_requested_at drives that timeout.
alter table connection drop constraint connection_status_check;
alter table connection add constraint connection_status_check
    check (status in ('pending', 'ok', 'syncing', 'error', 'awaiting'));
alter table connection add column sync_requested_at timestamptz;
