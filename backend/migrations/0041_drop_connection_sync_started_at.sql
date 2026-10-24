-- A sync now ends by itself (a time limit stops it), so a 'syncing' claim is
-- never taken over and needs no start time.
alter table connection drop column sync_started_at;
