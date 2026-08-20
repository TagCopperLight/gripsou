-- Flatten account classification onto a single reference table.
-- `category` was seeded 1:1 with `account_type`, so the hierarchy carried no
-- information. All five existing type keys survive unchanged, so no `account`
-- row needs remapping.

alter table account_type drop column category_key;

drop table category;

-- Wrappers that previously had nowhere to land: an assurance-vie or a PER was
-- mapped onto `brokerage`.
insert into account_type (key, label) values
    ('life_insurance', 'Life insurance'),
    ('retirement',     'Retirement');
