-- Allow connections to carry a 'pending' status while the OAuth round-trip
-- (connect → provider redirect → complete_connect) is in progress.
do $$
declare
    cname text;
begin
    select conname into cname
    from pg_constraint
    where conrelid = 'connection'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%';
    if cname is not null then
        execute format('alter table connection drop constraint %I', cname);
    end if;
end $$;

alter table connection
    add constraint connection_status_check
    check (status in ('ok', 'syncing', 'error', 'pending'));
