-- `category` mapped 1:1 onto `account_type`.
alter table account_type drop column category_key;

drop table category;

insert into account_type (key, label) values
    ('life_insurance', 'Life insurance'),
    ('retirement',     'Retirement');
