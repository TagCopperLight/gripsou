-- Cash's invested figure must be the balance held ON THAT DAY, not today's.
--
-- 0022 answered `holding.cost_basis` for every cash holding regardless of the
-- day asked for — a single current number, flat across all of history. The
-- holdings table only ever asks for today, so it never noticed; the net-worth
-- chart asks for ~200 sampled days and every one of them got the balance the
-- account happens to hold now.
--
-- The visible damage: on the live tree the "Capital invested" line read
-- 5 684,26 EUR on 2026-01-15 against a net worth of 4 349,24 EUR — the dashed
-- line sitting 1 335 EUR ABOVE the green area, because January's real 3 273,42
-- EUR of cash had been replaced by September's 4 700,09 EUR. The gap between
-- the two lines is supposed to be unrealised gain on securities and nothing
-- else, so cash must contribute exactly its own value on both sides.
--
-- The fix reads the same `holding_point` the net-worth side reads, with the
-- same "last point at or before this day" rule, so the two cancel by
-- construction. `quantity` and not `value`: the net-worth query prefers
-- `snap.quantity * unit_value` and only falls back to `snap.value`, and for a
-- cash holding the two are the same number anyway (map.rs sets both to the
-- balance).
--
-- Securities are untouched — their per-day walk through the lots was already
-- right. Everything else below is 0022 verbatim.
create or replace function lot_basis(p_holding_ids uuid[], p_days date[])
returns table (holding_id uuid, as_of date, mean_price numeric,
               explained_qty numeric, basis numeric, realised numeric)
language sql
stable
rows 10000
as $$
    with ids as (
        select distinct unnest(p_holding_ids) as holding_id
    ),
    days as (
        select distinct unnest(p_days) as as_of
    ),
    -- mu: the fee-inclusive lifetime mean buy price. Over ALL buys regardless
    -- of date, which is what makes it order-independent and lets everything
    -- below stay a plain aggregate instead of a recursive walk.
    mu as (
        select l.holding_id,
               sum(l.quantity * l.unit_price + l.fee)
                   / nullif(sum(l.quantity), 0) as mean_price
        from lot l
        join ids on ids.holding_id = l.holding_id
        where l.side = 'buy'
        group by l.holding_id
    ),
    -- The anchor, evaluated once per holding: what the provider says is held
    -- and what it cost, against what the lots actually account for.
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
    -- Cash only, and only for the days asked: the balance standing at the end
    -- of that day. NULL when the holding has no point yet (a day before its
    -- first snapshot or backfill row) — the caller's own snapshot join drops
    -- that holding-day from the net worth too, so the `provider_basis`
    -- fallback below keeps the holdings table answering for a never-synced
    -- holding without putting today's balance back into the chart's history.
    cash_day as (
        select a.holding_id, d.as_of, hp.quantity
        from anchor a
        cross join days d
        left join lateral (
            select p.quantity
            from holding_point p
            where p.holding_id = a.holding_id and p.as_of <= d.as_of
            order by p.as_of desc
            limit 1
        ) hp on true
        where a.is_cash
    ),
    -- Per requested day: the net quantity the lots explain, and the profit the
    -- sales up to that day realised.
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
           -- Deliberately nullable: NULL means no buy lots are recorded for
           -- this holding at all, which is NOT the same thing as a mean buy
           -- price of zero (a legitimate value — e.g. a free-share lot).
           -- Consumers that want a number coalesce at their own boundary
           -- (see basis_preview in core/src/repo/lot.rs).
           m.mean_price,
           p.explained_qty,
           case
               -- Cash is a holding of a cash instrument valued at book, so its
               -- basis IS its balance on the day — see the header.
               when a.is_cash then coalesce(cd.quantity, a.provider_basis)
               when m.mean_price is null then a.provider_basis
               -- The lots account for the position exactly, so they ARE the
               -- basis: nothing is unexplained to carry.
               when a.explained_now = a.held then m.mean_price * p.explained_qty
               -- Partial history: today anchors on the provider's figure and
               -- the unexplained remainder is carried flat backward (§8.2).
               else m.mean_price * p.explained_qty
                    + (a.provider_basis - m.mean_price * a.explained_now)
           end as basis,
           p.realised
    from per_day p
    join anchor a on a.holding_id = p.holding_id
    left join mu m on m.holding_id = p.holding_id
    left join cash_day cd on cd.holding_id = p.holding_id and cd.as_of = p.as_of
$$;
