-- The basis is now derived from `lot` at read time (0022), so storing it per
-- day is not just redundant, it is the AUDIT.md D-1 complaint verbatim: "cost
-- basis is stored in three tables and derived in a fourth place ... the stored
-- columns are known to be wrong and are being routed around at read time".
--
-- The lot rows ARE the history, so nothing is lost. `holding.cost_basis` stays:
-- it is the provider's current figure and remains the anchor lot_basis uses
-- when the recorded lots do not cover the position.
drop view holding_point;

alter table holding_snapshot drop column cost_basis;
alter table holding_backfill drop column cost_basis;

-- Recreated verbatim from 0014 minus the dropped column.
create view holding_point as
    select holding_id, as_of, quantity, value from holding_snapshot
    union all
    select holding_id, as_of, quantity, value from holding_backfill;
