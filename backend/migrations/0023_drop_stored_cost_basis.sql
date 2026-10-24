-- The basis is derived from `lot` at read time.
drop view holding_point;

alter table holding_snapshot drop column cost_basis;
alter table holding_backfill drop column cost_basis;

create view holding_point as
    select holding_id, as_of, quantity, value from holding_snapshot
    union all
    select holding_id, as_of, quantity, value from holding_backfill;
