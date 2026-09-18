-- Budget: a per-user taxonomy, tags, and the columns that hang a category off a
-- transaction. Everything is prefixed `budget_` because `category` already means
-- the account-type grouping (0001) — that collision was a bug once already.

create table budget_category (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users (id) on delete cascade,
    name        text not null,
    -- Stable key for the seeded rows so the frontend can translate them.
    -- Cleared on rename: from then on the user's own wording is shown verbatim.
    default_key text,
    color       text not null,
    icon        text,
    hint        text,
    kind        text not null check (kind in ('expense', 'income', 'internal', 'excluded')),
    -- Only 'internal_transfer'. Non-null means the pairing pass writes here, so
    -- the repository refuses to delete it.
    system_key  text,
    sort_order  int not null default 0,
    archived_at timestamptz,
    unique (user_id, name)
);

create unique index budget_category_system_uq
    on budget_category (user_id, system_key) where system_key is not null;

create table budget_tag (
    id      uuid primary key default gen_random_uuid(),
    user_id uuid not null references users (id) on delete cascade,
    name    text not null,
    color   text,
    unique (user_id, name)
);

create table budget_transaction_tag (
    transaction_id uuid not null references transaction (id) on delete cascade,
    tag_id         uuid not null references budget_tag (id) on delete cascade,
    primary key (transaction_id, tag_id)
);

create index budget_transaction_tag_tag_idx on budget_transaction_tag (tag_id);

-- Created now, unused until the rules phase. Its shape is settled by the spec
-- and one migration is cheaper than three.
create table budget_rule (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references users (id) on delete cascade,
    name                text not null,
    priority            int not null,
    enabled             boolean not null default true,
    condition           jsonb not null,
    set_category_id     uuid references budget_category (id) on delete set null,
    set_merchant_domain text,
    add_tag_ids         uuid[] not null default '{}',
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

-- Cache of "what does this description mean", keyed on the normalised string.
-- Written by the AI phase; read by the same phase. Created here with the rest.
create table budget_memo (
    user_id          uuid not null references users (id) on delete cascade,
    norm_description text not null,
    category_id      uuid references budget_category (id) on delete set null,
    confidence       numeric,
    origin           text not null check (origin in ('user', 'ai')),
    merchant_name    text,
    merchant_domain  text,
    updated_at       timestamptz not null default now(),
    primary key (user_id, norm_description)
);

create table budget_ai_run (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references users (id) on delete cascade,
    started_at timestamptz not null default now(),
    model      text not null,
    batches    int not null default 0,
    items      int not null default 0,
    tokens_in  int,
    tokens_out int,
    outcome    text not null check (outcome in ('ok', 'partial', 'error')),
    error      text
);

alter table transaction
    add column budget_category_id   uuid references budget_category (id) on delete set null,
    add column category_source      text check (category_source in ('user', 'rule', 'pair', 'ai')),
    add column category_confidence  numeric,
    add column category_reviewed_at timestamptz,
    add column checked_at           timestamptz,
    add column transfer_pair_id     uuid references transaction (id) on delete set null;

create index transaction_budget_category_idx on transaction (budget_category_id);

create index transaction_needs_review_idx
    on transaction (account_id)
    where category_source = 'ai' and category_reviewed_at is null;

-- The identity of "the same description": lowercased, card mask removed, dates
-- removed, digit runs removed, whitespace collapsed. No meaning is attached
-- beyond string identity (spec §5.1). Immutable so it can be indexed.
create function budget_norm_description(p text) returns text
language sql immutable as $$
    select btrim(regexp_replace(
        regexp_replace(
            regexp_replace(
                regexp_replace(lower(coalesce(p, '')), 'cb\*?[0-9]{4}', ' ', 'g'),
                '[0-9]{1,4}[/.-][0-9]{1,2}([/.-][0-9]{1,4})?', ' ', 'g'),
            '[0-9]{2,}', ' ', 'g'),
        '\s+', ' ', 'g'))
$$;

create index transaction_norm_description_idx
    on transaction (budget_norm_description(description));

-- Seeded taxonomy. Inserted per user rather than as global reference rows: the
-- user owns these from the first second and may rename or delete any of them.
-- Colours come from shared/account-palette.json so the UI stays one system.
create function seed_budget_categories(p_user uuid) returns void
language sql as $$
    insert into budget_category (user_id, name, default_key, color, icon, kind, system_key, sort_order)
    values
        (p_user, 'Groceries',            'groceries',     '#9bb06b', 'shopping-cart',    'expense',  null, 10),
        (p_user, 'Restaurants & bars',   'restaurants',   '#e88a5f', 'utensils',         'expense',  null, 20),
        (p_user, 'Transport',            'transport',     '#5b9bf0', 'train-front',      'expense',  null, 30),
        (p_user, 'Fuel',                 'fuel',          '#f0b952', 'fuel',             'expense',  null, 40),
        (p_user, 'Housing',              'housing',       '#b07ef0', 'house',            'expense',  null, 50),
        (p_user, 'Utilities',            'utilities',     '#4dd0b1', 'plug-zap',         'expense',  null, 60),
        (p_user, 'Insurance',            'insurance',     '#6aa0e0', 'shield',           'expense',  null, 70),
        (p_user, 'Health',               'health',        '#f08fb0', 'heart-pulse',      'expense',  null, 80),
        (p_user, 'Subscriptions',        'subscriptions', '#b8a8f0', 'repeat',           'expense',  null, 90),
        (p_user, 'Shopping',             'shopping',      '#f0b952', 'shopping-bag',     'expense',  null, 100),
        (p_user, 'Leisure',              'leisure',       '#5fcf9e', 'gamepad-2',        'expense',  null, 110),
        (p_user, 'Travel',               'travel',        '#5b9bf0', 'plane',            'expense',  null, 120),
        (p_user, 'Education',            'education',     '#b8a8f0', 'graduation-cap',   'expense',  null, 130),
        (p_user, 'Fees & charges',       'fees',          '#e88a5f', 'receipt',          'expense',  null, 140),
        (p_user, 'Taxes',                'taxes',         '#f08fb0', 'landmark',         'expense',  null, 150),
        (p_user, 'Gifts & donations',    'gifts',         '#b07ef0', 'gift',             'expense',  null, 160),
        (p_user, 'Other',                'other_expense', '#6aa0e0', 'circle-dashed',    'expense',  null, 170),
        (p_user, 'Salary',               'salary',        '#4dd0b1', 'wallet',           'income',   null, 10),
        (p_user, 'Dividends & interest', 'dividends',     '#5fcf9e', 'coins',            'income',   null, 20),
        (p_user, 'Refunds',              'refunds',       '#9bb06b', 'undo-2',           'income',   null, 30),
        (p_user, 'Other income',         'other_income',  '#6aa0e0', 'circle-plus',      'income',   null, 40),
        (p_user, 'Internal transfer',    'internal',      '#aeaaa7', 'arrow-left-right', 'internal', 'internal_transfer', 10),
        (p_user, 'Savings',              'savings',       '#4dd0b1', 'piggy-bank',       'internal', null, 20),
        (p_user, 'Investments',          'investments',   '#5fcf9e', 'trending-up',      'internal', null, 30),
        (p_user, 'Ignore',               'ignore',        '#777471', 'eye-off',          'excluded', null, 10)
    on conflict (user_id, name) do nothing;
$$;

create function seed_budget_categories_trg() returns trigger
language plpgsql as $$
begin
    perform seed_budget_categories(new.id);
    return new;
end
$$;

-- A trigger rather than application code: there are two user-creation sites
-- today and more will appear, and tests insert users directly.
create trigger users_seed_budget_categories
    after insert on users
    for each row execute function seed_budget_categories_trg();

-- Existing users get the same taxonomy.
select seed_budget_categories(id) from users;
