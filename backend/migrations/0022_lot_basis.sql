-- Cost basis: the fee-inclusive weighted average buy price (PRMP, as French tax
-- requires for a PEA or CTO), plus the part of the position no lot explains.
create function lot_basis(p_holding_ids uuid[], p_days date[])
returns table (holding_id uuid, as_of date, mean_price numeric,
               explained_qty numeric, basis numeric, realised numeric)
language sql
stable
-- The default estimate of 1000 rows makes the planner nested-loop the callers' joins.
rows 10000
as $$
    with ids as (
        select distinct unnest(p_holding_ids) as holding_id
    ),
    days as (
        select distinct unnest(p_days) as as_of
    ),
    -- Mean buy price over all buys, whatever their date, so no recursive walk is needed.
    mu as (
        select l.holding_id,
               sum(l.quantity * l.unit_price + l.fee)
                   / nullif(sum(l.quantity), 0) as mean_price
        from lot l
        join ids on ids.holding_id = l.holding_id
        where l.side = 'buy'
        group by l.holding_id
    ),
    -- What the provider says is held and cost, against what the lots explain.
    anchor as (
        select ids.holding_id,
               h.quantity   as held,
               h.cost_basis as provider_basis,
               i.kind = 'cash' as is_cash,
               coalesce(sum(case when l.side = 'buy' then l.quantity
                                 else -l.quantity end), 0) as explained_now
        from ids
        join holding h    on h.id = ids.holding_id
        join instrument i on i.id = h.instrument_id
        left join lot l   on l.holding_id = ids.holding_id
        group by ids.holding_id, h.quantity, h.cost_basis, i.kind
    ),
    -- Per day: the quantity the lots explain, and the profit realised by sales.
    per_day as (
        select ids.holding_id,
               d.as_of,
               coalesce(sum(case when l.side = 'buy' then l.quantity
                                 else -l.quantity end)
                        filter (where l.acquired_on <= d.as_of), 0) as explained_qty,
               coalesce(sum(l.quantity * (l.unit_price - m.mean_price) - l.fee)
                        filter (where l.side = 'sell'
                                  and l.acquired_on <= d.as_of), 0) as realised
        from ids
        cross join days d
        left join lot l on l.holding_id = ids.holding_id
        left join mu m  on m.holding_id = ids.holding_id
        group by ids.holding_id, d.as_of
    )
    select p.holding_id,
           p.as_of,
           -- NULL when no buy lot is recorded, unlike a real mean price of 0.
           m.mean_price,
           p.explained_qty,
           case
               when a.is_cash or m.mean_price is null then a.provider_basis
               -- The lots explain the whole position.
               when a.explained_now = a.held then m.mean_price * p.explained_qty
               -- The unexplained remainder is carried flat backward.
               else m.mean_price * p.explained_qty
                    + (a.provider_basis - m.mean_price * a.explained_now)
           end as basis,
           p.realised
    from per_day p
    join anchor a on a.holding_id = p.holding_id
    left join mu m on m.holding_id = p.holding_id
$$;
