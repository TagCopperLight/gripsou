-- The user's rows and the budget's category states, each stated once.

-- Every transaction the user owns.
create function user_transactions(p_user uuid)
returns setof transaction
language sql stable as $$
    select t.*
    from transaction t
    join account a    on a.id = t.account_id
    join connection c on c.id = a.connection_id
    where c.user_id = p_user
$$;

-- The user's transactions the budget reads: all but the cash leg of a
-- buy/sell, whose record is the lot.
create function budget_transactions(p_user uuid)
returns setof transaction
language sql stable as $$
    select t.*
    from user_transactions(p_user) t
    where not budget_investment_leg(t.type)
$$;

-- The user settled the row's category: they set it, or reviewed the AI's
-- guess. Pairing and the AI never overwrite it; the AI learns from it.
create function budget_user_chose(p_source text, p_reviewed_at timestamptz)
returns boolean
language sql immutable as $$
    select coalesce(p_source = 'user', false) or p_reviewed_at is not null
$$;

-- Nobody has filed the row: the AI still has to look at it.
create function budget_ai_pending(p_source text, p_category uuid, p_amount numeric)
returns boolean
language sql immutable as $$
    select p_source is null and p_category is null and p_amount <> 0
$$;

-- Pairing filed the row, and its partner is gone: the user recategorised the
-- other half.
create function budget_orphan_transfer(p_source text, p_pair uuid)
returns boolean
language sql immutable as $$
    select coalesce(p_source = 'pair' and p_pair is null, false)
$$;

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
           budget_orphan_transfer(t.category_source, t.transfer_pair_id),
           coalesce(bc.system_key = 'internal_transfer', false),
           null::text, null::text, null::text
    from budget_transactions(p_user) t
    join account a on a.id = t.account_id
    left join budget_category bc on bc.id = t.budget_category_id

    union all

    select l.id, l.acquired_on, l.side, null::text,
           lot_cash_amount(l.side, l.quantity, l.unit_price, l.fee),
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

-- A row uncategorised by a category delete that still reads as the user's or
-- the AI's choice is out of reach of the AI, review and pairing. Rows the user
-- set, and AI rows that carried a guess (a confidence or a review), go back to
-- nobody's. An AI row with no category, no confidence and no review is a
-- deliberate abstention and stays.
update transaction
   set category_source = null,
       category_confidence = null,
       category_reviewed_at = null
 where budget_category_id is null
   and (category_source = 'user'
        or (category_source = 'ai'
            and (category_confidence is not null or category_reviewed_at is not null)));
