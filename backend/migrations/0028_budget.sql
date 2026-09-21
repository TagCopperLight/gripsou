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
    -- Position within a kind, 1..n with no gaps: every write that changes the
    -- order renumbers the whole kind, so the numbers stay readable. The user
    -- arranges these in Settings; the list is never re-sorted behind them.
    sort_order  int not null default 0,
    archived_at timestamptz,
    unique (user_id, name)
);

create unique index budget_category_system_uq
    on budget_category (user_id, system_key) where system_key is not null;

-- Listed in creation order, not alphabetically: the list is short and personal,
-- and a tag just added belongs at the end where it was typed rather than
-- somewhere in the middle of the alphabet.
create table budget_tag (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references users (id) on delete cascade,
    name       text not null,
    color      text,
    created_at timestamptz not null default now(),
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
-- Colours walk one hue wheel at a fixed lightness and chroma —
-- `oklch(0.745 0.125 H)`, converted to sRGB here — so no category shouts
-- louder than its neighbour. Two rows keep a fixed hex where they mean
-- something: savings/investments the theme green, ignore the muted grey.
-- The hint is what the AI phase reads when it sorts a transaction: English
-- prompt text, unlike `default_key`, which translates the *name* only.
create function seed_budget_categories(p_user uuid) returns void
language sql as $$
    insert into budget_category
        (user_id, name, default_key, color, icon, kind, system_key, sort_order, hint)
    values
        (p_user, 'Housing'           , 'housing'         , '#f18c80', 'house'           , 'expense'  , null                ,  1, 'Rent, mortgage payments, service charges and property tax.'),
        (p_user, 'Utilities'         , 'utilities'       , '#ea945e', 'zap'             , 'expense'  , null                ,  2, 'Electricity, gas, water and heating.'),
        (p_user, 'Internet & phone'  , 'internet_phone'  , '#d9a147', 'smartphone'      , 'expense'  , null                ,  3, 'Internet access, mobile and landline plans.'),
        (p_user, 'Groceries'         , 'groceries'       , '#bfae46', 'shopping-cart'   , 'expense'  , null                ,  4, 'Supermarkets, grocers, markets and bakeries: food bought to take home.'),
        (p_user, 'Restaurants & bars', 'restaurants'     , '#9cba5d', 'utensils'        , 'expense'  , null                ,  5, 'Eating and drinking out: restaurants, cafés, bars, fast food, canteens and food delivery.'),
        (p_user, 'Transport'         , 'transport'       , '#72c27f', 'train-front'     , 'expense'  , null                ,  6, 'Getting around without fuel: trains, buses, metro passes, taxis, ride-hailing, tolls, parking, car hire and repairs.'),
        (p_user, 'Fuel'              , 'fuel'            , '#41c6a3', 'fuel'            , 'expense'  , null                ,  7, 'Petrol, diesel and EV charging at service stations.'),
        (p_user, 'Insurance'         , 'insurance'       , '#12c4c6', 'shield'          , 'expense'  , null                ,  8, 'Premiums for home, car, health, life and liability cover.'),
        (p_user, 'Health'            , 'health'          , '#30bee3', 'heart-pulse'     , 'expense'  , null                ,  9, 'Doctors, dentists, pharmacies, opticians, hospitals and therapy.'),
        (p_user, 'Subscriptions'     , 'subscriptions'   , '#60b4f5', 'repeat'          , 'expense'  , null                , 10, 'Recurring memberships and services: streaming, software, news, cloud storage.'),
        (p_user, 'Leisure'           , 'leisure'         , '#8aa9fc', 'film'            , 'expense'  , null                , 11, 'Cinema, concerts, games, books, hobbies and nights out.'),
        (p_user, 'Sport'             , 'sport'           , '#ae9df5', 'activity'        , 'expense'  , null                , 12, 'Gyms, clubs, licences, lessons and sports gear.'),
        (p_user, 'Travel'            , 'travel'          , '#cb93e2', 'plane'           , 'expense'  , null                , 13, 'Trips away from home: flights, hotels, holiday rentals and long-distance tickets.'),
        (p_user, 'Shopping'          , 'shopping'        , '#e18cc5', 'shopping-bag'    , 'expense'  , null                , 14, 'General retail that fits no other category: electronics, household goods, beauty.'),
        (p_user, 'Clothing'          , 'clothing'        , '#ee89a3', 'shirt'           , 'expense'  , null                , 15, 'Clothes, shoes and accessories.'),
        (p_user, 'Home & furniture'  , 'home_furniture'  , '#ef906e', 'lamp'            , 'expense'  , null                , 16, 'Furniture, decoration, appliances, DIY and home maintenance.'),
        (p_user, 'Gifts & donations' , 'gifts'           , '#e39a51', 'gift'            , 'expense'  , null                , 17, 'Presents bought for others, money given to family, and donations to charities.'),
        (p_user, 'Education'         , 'education'       , '#cda743', 'book-open'       , 'expense'  , null                , 18, 'Tuition, courses, exams, school fees and study material.'),
        (p_user, 'Cash withdrawals'  , 'cash_withdrawals', '#aeb44f', 'banknote'        , 'expense'  , null                , 19, 'Cash taken out at an ATM or a counter. What the cash was spent on afterwards is unknown.'),
        (p_user, 'Bank & broker fees', 'bank_fees'       , '#88be6d', 'percent'         , 'expense'  , null                , 20, 'Account and card fees, overdraft and payment interest, brokerage commissions, late-payment penalties.'),
        (p_user, 'Taxes'             , 'taxes'           , '#5ac491', 'landmark'        , 'expense'  , null                , 21, 'Payments to the tax authority: income tax, social contributions, local and vehicle taxes.'),
        (p_user, 'Pets'              , 'pets'            , '#27c6b5', 'paw-print'       , 'expense'  , null                , 22, 'Food, vets, insurance and supplies for an animal.'),
        (p_user, 'Other'             , 'other_expense'   , '#10c4cb', 'circle-dashed'   , 'expense'  , null                , 23, 'Expenses that fit no other category. Use only when nothing else is a reasonable match.'),
        (p_user, 'Salary'            , 'salary'          , '#18c2d5', 'wallet'          , 'income'   , null                ,  1, 'Pay from an employer or client: wages, bonuses, pensions and self-employment income.'),
        (p_user, 'Dividends'         , 'dividends'       , '#49baed', 'coins'           , 'income'   , null                ,  2, 'Dividends paid out by shares, funds and ETFs.'),
        (p_user, 'Interest'          , 'interest'        , '#76affa', 'piggy-bank'      , 'income'   , null                ,  3, 'Interest paid by savings accounts, bonds and deposits.'),
        (p_user, 'Reimbursements'    , 'reimbursements'  , '#9da3fa', 'undo-2'          , 'income'   , null                ,  4, 'Money coming back for something already paid: merchant refunds, expense claims, insurance and tax rebates.'),
        (p_user, 'Other income'      , 'other_income'    , '#b99af0', 'circle-plus'     , 'income'   , null                ,  5, 'Incoming money that fits no other category: benefits, gifts received, one-off payments from people.'),
        (p_user, 'Internal transfer' , 'internal'        , '#be98ec', 'arrow-left-right', 'internal' , 'internal_transfer' ,  1, 'Money moved between your own accounts. Neither spending nor income — the pairing pass writes here.'),
        (p_user, 'Savings'           , 'savings'         , '#34d399', 'piggy-bank'      , 'internal' , null                ,  2, 'Money set aside into a savings account: it is still yours, not spending.'),
        (p_user, 'Investments'       , 'investments'     , '#34d399', 'trending-up'     , 'internal' , null                ,  3, 'Money moved into a brokerage or investment account, and securities bought with it.'),
        (p_user, 'Ignore'            , 'ignore'          , '#777471', 'eye-off'         , 'excluded' , null                ,  1, 'Rows to leave out of every total: duplicates, corrections and anything that should not count.')
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
