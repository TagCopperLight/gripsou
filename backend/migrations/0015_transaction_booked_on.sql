-- The day the bank moved the money, which can differ from `ts` by days. Null
-- when the provider reports only one date.
alter table transaction add column booked_on date;
