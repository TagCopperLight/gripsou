-- Reference data (ARCHITECTURE §3.2). New rows here are data inserts, not migrations.

insert into category (key, label) values
    ('cash',      'Cash'),
    ('savings',   'Savings'),
    ('pea',       'PEA'),
    ('brokerage', 'Brokerage'),
    ('crypto',    'Crypto');

insert into account_type (key, label, category_key) values
    ('checking',  'Checking',        'cash'),
    ('savings',   'Savings account', 'savings'),
    ('pea',       'PEA',             'pea'),
    ('brokerage', 'Brokerage',       'brokerage'),
    ('crypto',    'Crypto wallet',   'crypto');

insert into provider (key, display_name, kind, enabled) values
    ('powens',     'Powens',      'account', true),
    ('marketdata', 'Market Data', 'price',   true);

insert into app_settings (id, cors_origins, enabled_providers) values
    (1, '{}', '{powens,marketdata}');
