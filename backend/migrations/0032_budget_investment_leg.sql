-- A buy/sell is the cash leg of an investment, on whatever account it lands:
-- the `lot` is the record of the purchase, and the user's lots outrank
-- anything imported. Every budget reader leaves these rows out — the list
-- would show a purchase twice (or three times, with a broker's echo account),
-- and moving cash into a security is neither spending nor income.
--
-- Replaces `budget_hidden_pea_leg` (0028), which only looked at accounts of
-- type `pea` and so let Trade Republic's trades (booked on a checking account
-- and mirrored on a brokerage one) through. `external_id` is no longer tested:
-- since 0024 `transaction` is cash-only and hand-entered purchases live in
-- `lot`.
--
-- Charts and the balance backfill do NOT use this: the cash balance really
-- moved.
--
-- Plain SQL and immutable, so the planner inlines it into every caller.
create function budget_investment_leg(p_type text)
returns boolean
language sql immutable as $$
    select p_type in ('buy', 'sell')
$$;

create or replace function budget_transaction_rows(p_user uuid, p_threshold numeric)
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
           coalesce(bc.system_key = 'internal_transfer', false),
           null::text
    from transaction t
    join account a    on a.id = t.account_id
    join connection c on c.id = a.connection_id
    left join budget_category bc on bc.id = t.budget_category_id
    where c.user_id = p_user
      and not budget_investment_leg(t.type)

    union all

    select l.id, l.acquired_on::timestamp at time zone 'UTC', l.side, null::text,
           case when l.side = 'buy' then -(l.quantity * l.unit_price + l.fee)
                else l.quantity * l.unit_price - l.fee end,
           'lot'::text,
           coalesce(i.symbol, i.meta->>'yahoo_symbol', i.isin, i.name),
           l.quantity, l.unit_price, l.fee,
           a.id, a.name, a.color, a.currency,
           null::uuid, null::text, null::text, null::text, null::text, null::text,
           null::text, null::numeric, false, false, false, false, false,
           i.logo_url
    from lot l
    join holding h    on h.id = l.holding_id
    join instrument i on i.id = h.instrument_id
    join account a    on a.id = h.account_id
    join connection c on c.id = a.connection_id
    where c.user_id = p_user
$$;

drop function budget_hidden_pea_leg(text, text, text);
