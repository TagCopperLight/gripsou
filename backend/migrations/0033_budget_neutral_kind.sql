-- One `neutral` kind replaces `internal` and `excluded`. With every account
-- connected, moving money is neither spending nor income nor saving: saving
-- is income - expenses. Internal transfer, Investments, Savings and Ignore are
-- names on the same behaviour — counted in no total. The Overview's "Saved"
-- figure, the only thing that told the two kinds apart, is gone.

alter table budget_category drop constraint budget_category_kind_check;

-- Former internal rows first, then former excluded ones, each in its old
-- order: Internal transfer, Savings, Investments, Ignore for an untouched
-- user. Renumbered 1..n so the kind keeps its no-gap invariant.
with ranked as (
    select id,
           row_number() over (partition by user_id
                              order by (kind = 'excluded'), sort_order, lower(name)) as ord
    from budget_category
    where kind in ('internal', 'excluded')
)
update budget_category c
   set kind = 'neutral', sort_order = r.ord
  from ranked r
 where r.id = c.id;

alter table budget_category
    add constraint budget_category_kind_check
    check (kind in ('expense', 'income', 'neutral'));

-- The review rule: a guess into a neutral category hides money from every
-- total, so it is always reviewed however confident.
create or replace function budget_needs_review(
    p_source text, p_reviewed_at timestamptz, p_confidence numeric,
    p_category_kind text, p_threshold numeric)
returns boolean
language sql immutable as $$
    select p_source = 'ai'
       and p_reviewed_at is null
       and (p_confidence is null
            or p_confidence < p_threshold
            or p_category_kind = 'neutral')
$$;

create or replace function seed_budget_categories(p_user uuid) returns void
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
        (p_user, 'Internal transfer' , 'internal'        , '#be98ec', 'arrow-left-right', 'neutral'  , 'internal_transfer' ,  1, 'Money moved between your own accounts. Neither spending nor income — the pairing pass writes here.'),
        (p_user, 'Savings'           , 'savings'         , '#34d399', 'piggy-bank'      , 'neutral'  , null                ,  2, 'Money set aside into a savings account: it is still yours, not spending.'),
        (p_user, 'Investments'       , 'investments'     , '#34d399', 'trending-up'     , 'neutral'  , null                ,  3, 'Money moved into a brokerage or investment account, and securities bought with it.'),
        (p_user, 'Ignore'            , 'ignore'          , '#777471', 'eye-off'         , 'neutral'  , null                ,  4, 'Rows to leave out of every total: duplicates, corrections and anything that should not count.')
    on conflict (user_id, name) do nothing;
$$;
