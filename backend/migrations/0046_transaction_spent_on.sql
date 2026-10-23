-- A transaction happens on a day: providers give dates, never times. Stored
-- as a date, nothing has to cast it back to one, and no reader can take the
-- day in the session's timezone instead of the provider's.
alter table transaction add column spent_on date;
update transaction set spent_on = (ts at time zone 'utc')::date;
alter table transaction alter column spent_on set not null;
alter table transaction drop column ts;
alter table transaction drop column fee;
create index transaction_account_spent_on_idx on transaction (account_id, spent_on desc);

drop function txn_day(boolean, date, timestamptz);
-- The day a transaction moved the balance. `trust` says whether the account's
-- booking dates are real: some connectors send the statement period instead.
create function txn_day(trust boolean, booked date, spent date)
    returns date
    language sql
    immutable
as $$
    select case when trust then coalesce(booked, spent) else spent end
$$;

-- Lots and transactions both happen on a day.
alter type budget_transaction_row rename attribute ts to day;
alter type budget_transaction_row alter attribute day type date;

create or replace function budget_transaction_rows(p_user uuid, p_threshold numeric)
returns setof budget_transaction_row
language sql stable as $$
    select t.id, t.spent_on, t.type, t.description, t.amount,
           'cash'::text, null::text, null::numeric, null::numeric, null::numeric,
           a.id, a.name, a.color, a.currency,
           t.budget_category_id, bc.name, bc.default_key, bc.color, bc.icon, bc.kind,
           t.category_source, t.category_confidence,
           coalesce(budget_needs_review(t.category_source, t.category_reviewed_at,
                                        t.category_confidence, bc.kind, p_threshold), false),
           t.checked_at is not null,
           t.transfer_pair_id is not null,
           coalesce(t.category_source = 'pair' and t.transfer_pair_id is null, false),
           coalesce(bc.system_key = 'internal_transfer', false),
           null::text, null::text, null::text
    from transaction t
    join account a    on a.id = t.account_id
    join connection c on c.id = a.connection_id
    left join budget_category bc on bc.id = t.budget_category_id
    where c.user_id = p_user
      and not budget_investment_leg(t.type)

    union all

    select l.id, l.acquired_on, l.side, null::text,
           case when l.side = 'buy' then -(l.quantity * l.unit_price + l.fee)
                else l.quantity * l.unit_price - l.fee end,
           'lot'::text,
           coalesce(i.symbol, i.meta->>'yahoo_symbol', i.isin, i.name),
           l.quantity, l.unit_price, l.fee,
           a.id, a.name, a.color, a.currency,
           null::uuid, null::text, null::text, null::text, null::text, null::text,
           null::text, null::numeric, false, false, false, false, false,
           i.kind, i.isin, i.symbol
    from lot l
    join holding h    on h.id = l.holding_id
    join instrument i on i.id = h.instrument_id
    join account a    on a.id = h.account_id
    join connection c on c.id = a.connection_id
    where c.user_id = p_user
$$;

create or replace function budget_transaction_matches(
    p_user uuid, p_threshold numeric, p_search text, p_account uuid,
    p_from date, p_to date, p_bucket text, p_categories uuid[], p_tags uuid[],
    p_uncategorized boolean, p_needs_review boolean, p_include_transfers boolean)
returns setof budget_transaction_row
language sql stable as $$
    select r.*
    from budget_transaction_rows(p_user, p_threshold) r
    where (p_search is null
           -- Lot rows have no description; the list shows their ticker.
           or r.description ilike '%' || p_search || '%'
           or r.ticker ilike '%' || p_search || '%')
      and (p_account is null or r.account_id = p_account)
      and (p_from is null or r.day >= p_from)
      and (p_to is null or r.day <= p_to)
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
