-- Provider catalog gains a human description for the Server settings UI.
-- Additive: the 0002 seed is left unchanged; existing rows are backfilled here.
alter table provider add column description text;

update provider set description =
    'European bank & brokerage aggregation. Connects checking, savings, PEA and brokerage accounts.'
    where key = 'powens';

update provider set description =
    'Market quotes for securities and crypto used to value holdings.'
    where key = 'marketdata';
