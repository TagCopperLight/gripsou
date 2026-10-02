-- Lot rows in the Transactions list name their instrument the way the
-- Holdings card does, and carry its logo.
--
-- The ticker used to fall back from `symbol` straight to the ISIN, so an
-- ISIN-identified instrument (symbol is null there by design) showed as
-- `US84615Q1031` while Holdings showed its resolved Yahoo ticker. Same
-- fallback as the holdings query now: symbol, then the resolved ticker in
-- meta, then the ISIN, then the name.
--
-- `logo_url` is appended rather than placed next to `ticker`: `add attribute`
-- only appends, and `budget_transaction_matches` returns `r.*` so it follows
-- the type without being touched.
alter type budget_transaction_row add attribute logo_url text;

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
      and not budget_hidden_pea_leg(a.type_key, t.external_id, t.type)

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
