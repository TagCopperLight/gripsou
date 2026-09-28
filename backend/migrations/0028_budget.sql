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

alter table transaction
    add column budget_category_id   uuid references budget_category (id) on delete set null,
    add column category_source      text check (category_source in ('user', 'pair', 'ai')),
    add column category_confidence  numeric,
    add column category_reviewed_at timestamptz,
    add column checked_at           timestamptz,
    add column transfer_pair_id     uuid references transaction (id) on delete set null;

create index transaction_budget_category_idx on transaction (budget_category_id);

-- Deleting a transaction clears every link pointing at it; without this each
-- deleted row scans the whole table to find its partner.
create index transaction_transfer_pair_idx
    on transaction (transfer_pair_id) where transfer_pair_id is not null;

-- A paired row whose partner is deleted (its connection removed) no longer
-- nets against anything, yet it would keep the internal-transfer category and
-- count as money set aside. Hand it back to the pipeline instead: uncategorised
-- again, and a candidate for the next pairing pass. A pair the user breaks by
-- recategorising one half is left alone: its partner still exists, and the
-- untouched half stays flagged as an orphaned transfer.
create function transaction_partner_deleted_trg() returns trigger
language plpgsql as $$
begin
    if not exists (select 1 from transaction where id = old.transfer_pair_id) then
        new.budget_category_id := null;
        new.category_source := null;
    end if;
    return new;
end
$$;

create trigger transaction_partner_deleted
    before update of transfer_pair_id on transaction
    for each row
    when (old.transfer_pair_id is not null
          and new.transfer_pair_id is null
          and new.category_source = 'pair')
    execute function transaction_partner_deleted_trg();

create index transaction_needs_review_idx
    on transaction (account_id)
    where category_source = 'ai' and category_reviewed_at is null;

-- The identity of "the same description": lowercased, dates removed, digit
-- runs removed, whitespace collapsed. No meaning is attached beyond string
-- identity. Card masks are the adapter's to strip at ingest; any left over
-- lose their digits here like every other number. Immutable so the
-- generated `transaction.description_norm` column (0029) can use it.
create function budget_norm_description(p text) returns text
language sql immutable as $$
    select btrim(regexp_replace(
        regexp_replace(
            regexp_replace(lower(coalesce(p, '')),
                '[0-9]{1,4}[/.-][0-9]{1,2}([/.-][0-9]{1,4})?', ' ', 'g'),
            '[0-9]{2,}', ' ', 'g'),
        '\s+', ' ', 'g'))
$$;

-- A provider buy/sell on a PEA is the cash leg of a purchase the `lot` table
-- already holds. Every budget reader leaves it out: the list would show the
-- purchase twice, and buying an ETF is not spending. Scoped to provider rows
-- (`external_id is not null`); the user's own purchases live in `lot`.
--
-- Transfers into the PEA are NOT covered: pairing files both halves as
-- internal transfer, which is what keeps them from double-counting.
--
-- Plain SQL and immutable, so the planner inlines it into every caller.
create function budget_hidden_pea_leg(p_account_type text, p_external_id text, p_type text)
returns boolean
language sql immutable as $$
    select p_account_type = 'pea' and p_external_id is not null and p_type in ('buy', 'sell')
$$;

-- The review rule: an unreviewed AI guess below the reader's threshold, with
-- no category, or filed as internal/excluded — a guess there hides money from
-- every total, so it is always reviewed however confident. Null (not false)
-- when `category_source` is null, like the bare predicate it replaces, so a
-- `where` clause can still match the partial index on unreviewed AI rows;
-- a selected column wraps it in `coalesce`.
create function budget_needs_review(
    p_source text, p_reviewed_at timestamptz, p_confidence numeric,
    p_category_kind text, p_threshold numeric)
returns boolean
language sql immutable as $$
    select p_source = 'ai'
       and p_reviewed_at is null
       and (p_confidence is null
            or p_confidence < p_threshold
            or p_category_kind in ('internal', 'excluded'))
$$;

-- One row of the Transactions list, cash or lot.
create type budget_transaction_row as (
    id uuid, ts timestamptz, kind text, description text, amount numeric,
    source text, ticker text, quantity numeric, unit_price numeric, fee numeric,
    account_id uuid, account_name text, account_color text, account_currency text,
    category_id uuid, category_name text, category_default_key text,
    category_color text, category_icon text, category_kind text,
    category_source text, category_confidence numeric,
    needs_review boolean, checked boolean, is_transfer boolean,
    -- The pairing pass filed this row but its link is gone: a user corrected
    -- the other half. Keyed on the source, since only pairing writes 'pair'
    -- and it always writes a link.
    is_orphan_transfer boolean,
    -- Filtered on, never shown: the list hides internal transfers by default.
    is_internal_transfer boolean);

-- Every row of the Transactions list, unfiltered: the user's cash
-- transactions (minus the hidden PEA legs) and their lots. Lots reach the
-- list as structured rows so the frontend's i18n formats them; they carry no
-- budget. A buy's amount is -(qty x price + fee), a sale's
-- +(qty x price - fee): the real cash impact either way.
--
-- Stable, plain SQL and not strict, so the planner inlines it and pushes the
-- caller's filters into both branches.
create function budget_transaction_rows(p_user uuid, p_threshold numeric)
returns setof budget_transaction_row
language sql stable as $$
    select t.id, t.ts, t.type, t.description, t.amount,
           'cash'::text, null::text, null::numeric, null::numeric, null::numeric,
           a.id, a.name, a.color, a.currency,
           t.budget_category_id, bc.name, bc.default_key, bc.color, bc.icon, bc.kind,
           t.category_source, t.category_confidence,
           coalesce(budget_needs_review(t.category_source, t.category_reviewed_at,
                                        t.category_confidence, bc.kind, p_threshold), false),
           t.checked_at is not null,
           t.transfer_pair_id is not null,
           coalesce(t.category_source = 'pair' and t.transfer_pair_id is null, false),
           coalesce(bc.system_key = 'internal_transfer', false)
    from transaction t
    join account a    on a.id = t.account_id
    join connection c on c.id = a.connection_id
    left join budget_category bc on bc.id = t.budget_category_id
    where c.user_id = p_user
      and not budget_hidden_pea_leg(a.type_key, t.external_id, t.type)

    union all

    select l.id, l.acquired_on::timestamp at time zone 'UTC', l.side, null::text,
           case when l.side = 'buy' then -(l.quantity * l.unit_price + l.fee)
                else l.quantity * l.unit_price - l.fee end,
           'lot'::text,
           -- `symbol` is null whenever an ISIN identifies the instrument, the
           -- common case on a PEA: fall back to the ISIN before the name.
           coalesce(i.symbol, i.isin, i.name),
           l.quantity, l.unit_price, l.fee,
           a.id, a.name, a.color, a.currency,
           null::uuid, null::text, null::text, null::text, null::text, null::text,
           null::text, null::numeric, false, false, false, false, false
    from lot l
    join holding h    on h.id = l.holding_id
    join instrument i on i.id = h.instrument_id
    join account a    on a.id = h.account_id
    join connection c on c.id = a.connection_id
    where c.user_id = p_user
$$;

-- The Transactions filter, defined once: the list pages it, the header counts
-- it, and "select all shown" writes to its cash rows. Every argument but the
-- first two is optional (null, empty, false or 'all' means no filter), except
-- `p_include_transfers`: internal transfers are hidden unless it is set.
--
-- Days are UTC days, matched on `ts` directly so an index on it stays usable.
create function budget_transaction_matches(
    p_user uuid, p_threshold numeric,
    p_search text, p_account uuid, p_from date, p_to date, p_bucket text,
    p_categories uuid[], p_tags uuid[], p_uncategorized boolean,
    p_needs_review boolean, p_include_transfers boolean)
returns setof budget_transaction_row
language sql stable as $$
    select r.*
    from budget_transaction_rows(p_user, p_threshold) r
    where (p_search is null
           -- Lot rows have no description; the list shows their ticker.
           or r.description ilike '%' || p_search || '%'
           or r.ticker ilike '%' || p_search || '%')
      and (p_account is null or r.account_id = p_account)
      and (p_from is null or r.ts >= (p_from::timestamp at time zone 'UTC'))
      and (p_to is null or r.ts < ((p_to + 1)::timestamp at time zone 'UTC'))
      and (p_bucket = 'all'
           or (p_bucket = 'in'   and r.source = 'cash' and r.amount > 0)
           or (p_bucket = 'out'  and r.source = 'cash' and r.amount < 0)
           or (p_bucket = 'lots' and r.source = 'lot'))
      and (cardinality(p_categories) = 0 or r.category_id = any(p_categories))
      and (not p_uncategorized or (r.source = 'cash' and r.category_id is null))
      and (not p_needs_review or r.needs_review)
      -- Several tags mean all of them.
      and (cardinality(p_tags) = 0
           or (select count(distinct tt.tag_id)
                 from budget_transaction_tag tt
                where tt.transaction_id = r.id
                  and tt.tag_id = any(p_tags)) = cardinality(p_tags))
      and (p_include_transfers or not r.is_internal_transfer)
$$;

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
