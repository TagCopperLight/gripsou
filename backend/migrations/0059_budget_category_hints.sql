-- Plainer AI hints for the seeded categories. Rows whose hint the user never
-- changed take the new text; edited hints are the user's and stay.
create or replace function seed_budget_categories(p_user uuid) returns void
language sql as $$
    insert into budget_category
        (user_id, name, default_key, color, icon, kind, system_key, sort_order, hint)
    values
        (p_user, 'Housing'           , 'housing'         , '#f18c80', 'house'           , 'expense'  , null                ,  1, 'Rent, mortgage payments, service charges and property tax.'),
        (p_user, 'Utilities'         , 'utilities'       , '#ea945e', 'zap'             , 'expense'  , null                ,  2, 'Electricity, gas, water and heating bills.'),
        (p_user, 'Internet & phone'  , 'internet_phone'  , '#d9a147', 'smartphone'      , 'expense'  , null                ,  3, 'Internet, mobile and landline plans.'),
        (p_user, 'Groceries'         , 'groceries'       , '#bfae46', 'shopping-cart'   , 'expense'  , null                ,  4, 'Supermarkets, grocers, markets and bakeries: food and household basics bought to take home.'),
        (p_user, 'Restaurants & bars', 'restaurants'     , '#9cba5d', 'utensils'        , 'expense'  , null                ,  5, 'Restaurants, cafés, bars, fast food, canteens and food delivery.'),
        (p_user, 'Transport'         , 'transport'       , '#72c27f', 'train-front'     , 'expense'  , null                ,  6, 'Trains, buses, metro passes, taxis, ride-hailing, tolls, parking, car hire and car repairs. Not fuel.'),
        (p_user, 'Fuel'              , 'fuel'            , '#41c6a3', 'fuel'            , 'expense'  , null                ,  7, 'Petrol, diesel and electric car charging.'),
        (p_user, 'Insurance'         , 'insurance'       , '#12c4c6', 'shield'          , 'expense'  , null                ,  8, 'Home, car, health, life and liability insurance premiums.'),
        (p_user, 'Health'            , 'health'          , '#30bee3', 'heart-pulse'     , 'expense'  , null                ,  9, 'Doctors, dentists, pharmacies, opticians, hospitals and therapy.'),
        (p_user, 'Subscriptions'     , 'subscriptions'   , '#60b4f5', 'repeat'          , 'expense'  , null                , 10, 'Recurring services and memberships: streaming, software, news, cloud storage.'),
        (p_user, 'Leisure'           , 'leisure'         , '#8aa9fc', 'film'            , 'expense'  , null                , 11, 'Cinema, concerts, games, books, hobbies and nights out.'),
        (p_user, 'Sport'             , 'sport'           , '#ae9df5', 'activity'        , 'expense'  , null                , 12, 'Gyms, clubs, licences, lessons and sports gear.'),
        (p_user, 'Travel'            , 'travel'          , '#cb93e2', 'plane'           , 'expense'  , null                , 13, 'Trips away from home: flights, hotels, holiday rentals and long-distance train or coach tickets.'),
        (p_user, 'Shopping'          , 'shopping'        , '#e18cc5', 'shopping-bag'    , 'expense'  , null                , 14, 'General retail with no better category: electronics, household goods, beauty.'),
        (p_user, 'Clothing'          , 'clothing'        , '#ee89a3', 'shirt'           , 'expense'  , null                , 15, 'Clothes, shoes and accessories.'),
        (p_user, 'Home & furniture'  , 'home_furniture'  , '#ef906e', 'lamp'            , 'expense'  , null                , 16, 'Furniture, decoration, appliances, DIY and home repairs.'),
        (p_user, 'Gifts & donations' , 'gifts'           , '#e39a51', 'gift'            , 'expense'  , null                , 17, 'Presents for others, money given to family or friends, and donations to charities.'),
        (p_user, 'Education'         , 'education'       , '#cda743', 'book-open'       , 'expense'  , null                , 18, 'Tuition, courses, exams, school fees and study material.'),
        (p_user, 'Cash withdrawals'  , 'cash_withdrawals', '#aeb44f', 'banknote'        , 'expense'  , null                , 19, 'Cash taken out at an ATM or a bank counter.'),
        (p_user, 'Bank & broker fees', 'bank_fees'       , '#88be6d', 'percent'         , 'expense'  , null                , 20, 'Account and card fees, overdraft interest, brokerage commissions and late-payment penalties.'),
        (p_user, 'Taxes'             , 'taxes'           , '#5ac491', 'landmark'        , 'expense'  , null                , 21, 'Income tax, social contributions, and local and vehicle taxes paid to the state.'),
        (p_user, 'Pets'              , 'pets'            , '#27c6b5', 'paw-print'       , 'expense'  , null                , 22, 'Pet food, vets, pet insurance and supplies.'),
        (p_user, 'Other'             , 'other_expense'   , '#10c4cb', 'circle-dashed'   , 'expense'  , null                , 23, 'Spending with no better category. Use only when nothing else fits.'),
        (p_user, 'Salary'            , 'salary'          , '#18c2d5', 'wallet'          , 'income'   , null                ,  1, 'Pay from an employer or clients: wages, bonuses, pensions and self-employment income.'),
        (p_user, 'Dividends'         , 'dividends'       , '#49baed', 'coins'           , 'income'   , null                ,  2, 'Dividends paid by shares, funds and ETFs.'),
        (p_user, 'Interest'          , 'interest'        , '#76affa', 'piggy-bank'      , 'income'   , null                ,  3, 'Interest paid by savings accounts, bonds and deposits.'),
        (p_user, 'Reimbursements'    , 'reimbursements'  , '#9da3fa', 'undo-2'          , 'income'   , null                ,  4, 'Money back for something already paid: refunds, expense claims, insurance payouts and tax rebates.'),
        (p_user, 'Other income'      , 'other_income'    , '#b99af0', 'circle-plus'     , 'income'   , null                ,  5, 'Incoming money with no better category: benefits, gifts received, one-off payments from people.'),
        (p_user, 'Internal transfer' , 'internal'        , '#be98ec', 'arrow-left-right', 'neutral'  , 'internal_transfer' ,  1, 'Money moved between your own accounts. gripsou finds these itself.'),
        (p_user, 'Savings'           , 'savings'         , '#34d399', 'piggy-bank'      , 'neutral'  , null                ,  2, 'Money put into a savings account. It is still yours, so it is not spending.'),
        (p_user, 'Investments'       , 'investments'     , '#34d399', 'trending-up'     , 'neutral'  , null                ,  3, 'Money moved into a brokerage or investment account, and securities bought with it.'),
        (p_user, 'Ignore'            , 'ignore'          , '#777471', 'eye-off'         , 'neutral'  , null                ,  4, 'Transactions to leave out of every total: duplicates, corrections, and anything that shouldn''t count.')
    on conflict (user_id, name) do nothing;
$$;

update budget_category c
   set hint = h.new_hint
  from (values
    ('housing', 'Rent, mortgage payments, service charges and property tax.', 'Rent, mortgage payments, service charges and property tax.'),
    ('utilities', 'Electricity, gas, water and heating.', 'Electricity, gas, water and heating bills.'),
    ('internet_phone', 'Internet access, mobile and landline plans.', 'Internet, mobile and landline plans.'),
    ('groceries', 'Supermarkets, grocers, markets and bakeries: food bought to take home.', 'Supermarkets, grocers, markets and bakeries: food and household basics bought to take home.'),
    ('restaurants', 'Eating and drinking out: restaurants, cafés, bars, fast food, canteens and food delivery.', 'Restaurants, cafés, bars, fast food, canteens and food delivery.'),
    ('transport', 'Getting around without fuel: trains, buses, metro passes, taxis, ride-hailing, tolls, parking, car hire and repairs.', 'Trains, buses, metro passes, taxis, ride-hailing, tolls, parking, car hire and car repairs. Not fuel.'),
    ('fuel', 'Petrol, diesel and EV charging at service stations.', 'Petrol, diesel and electric car charging.'),
    ('insurance', 'Premiums for home, car, health, life and liability cover.', 'Home, car, health, life and liability insurance premiums.'),
    ('health', 'Doctors, dentists, pharmacies, opticians, hospitals and therapy.', 'Doctors, dentists, pharmacies, opticians, hospitals and therapy.'),
    ('subscriptions', 'Recurring memberships and services: streaming, software, news, cloud storage.', 'Recurring services and memberships: streaming, software, news, cloud storage.'),
    ('leisure', 'Cinema, concerts, games, books, hobbies and nights out.', 'Cinema, concerts, games, books, hobbies and nights out.'),
    ('sport', 'Gyms, clubs, licences, lessons and sports gear.', 'Gyms, clubs, licences, lessons and sports gear.'),
    ('travel', 'Trips away from home: flights, hotels, holiday rentals and long-distance tickets.', 'Trips away from home: flights, hotels, holiday rentals and long-distance train or coach tickets.'),
    ('shopping', 'General retail that fits no other category: electronics, household goods, beauty.', 'General retail with no better category: electronics, household goods, beauty.'),
    ('clothing', 'Clothes, shoes and accessories.', 'Clothes, shoes and accessories.'),
    ('home_furniture', 'Furniture, decoration, appliances, DIY and home maintenance.', 'Furniture, decoration, appliances, DIY and home repairs.'),
    ('gifts', 'Presents bought for others, money given to family, and donations to charities.', 'Presents for others, money given to family or friends, and donations to charities.'),
    ('education', 'Tuition, courses, exams, school fees and study material.', 'Tuition, courses, exams, school fees and study material.'),
    ('cash_withdrawals', 'Cash taken out at an ATM or a counter. What the cash was spent on afterwards is unknown.', 'Cash taken out at an ATM or a bank counter.'),
    ('bank_fees', 'Account and card fees, overdraft and payment interest, brokerage commissions, late-payment penalties.', 'Account and card fees, overdraft interest, brokerage commissions and late-payment penalties.'),
    ('taxes', 'Payments to the tax authority: income tax, social contributions, local and vehicle taxes.', 'Income tax, social contributions, and local and vehicle taxes paid to the state.'),
    ('pets', 'Food, vets, insurance and supplies for an animal.', 'Pet food, vets, pet insurance and supplies.'),
    ('other_expense', 'Expenses that fit no other category. Use only when nothing else is a reasonable match.', 'Spending with no better category. Use only when nothing else fits.'),
    ('salary', 'Pay from an employer or client: wages, bonuses, pensions and self-employment income.', 'Pay from an employer or clients: wages, bonuses, pensions and self-employment income.'),
    ('dividends', 'Dividends paid out by shares, funds and ETFs.', 'Dividends paid by shares, funds and ETFs.'),
    ('interest', 'Interest paid by savings accounts, bonds and deposits.', 'Interest paid by savings accounts, bonds and deposits.'),
    ('reimbursements', 'Money coming back for something already paid: merchant refunds, expense claims, insurance and tax rebates.', 'Money back for something already paid: refunds, expense claims, insurance payouts and tax rebates.'),
    ('other_income', 'Incoming money that fits no other category: benefits, gifts received, one-off payments from people.', 'Incoming money with no better category: benefits, gifts received, one-off payments from people.'),
    ('internal', 'Money moved between your own accounts. Neither spending nor income — the pairing pass writes here.', 'Money moved between your own accounts. gripsou finds these itself.'),
    ('savings', 'Money set aside into a savings account: it is still yours, not spending.', 'Money put into a savings account. It is still yours, so it is not spending.'),
    ('investments', 'Money moved into a brokerage or investment account, and securities bought with it.', 'Money moved into a brokerage or investment account, and securities bought with it.'),
    ('ignore', 'Rows to leave out of every total: duplicates, corrections and anything that should not count.', 'Transactions to leave out of every total: duplicates, corrections, and anything that shouldn''t count.')
  ) as h(seed_key, old_hint, new_hint)
 where c.seed_key = h.seed_key
   and c.hint = h.old_hint;
