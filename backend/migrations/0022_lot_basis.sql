-- THE definition of cost basis. Every consumer calls this and nothing
-- reimplements it — that is the entire point (AUDIT.md D-1, Z-1, C-7).
--
-- Before this, the rule existed four times: backfill.rs's mean_buy + lots CTEs,
-- query.rs's `lot` lateral, frontend/src/lib/lots.ts, and
-- frontend/src/lib/assetSeries.ts — the last of which computed something
-- different, folding a sale's proceeds into the basis.
--
-- Method is PRMP: the fee-inclusive lifetime weighted average. That is what
-- French tax requires for a PEA or CTO (and France uses a portfolio-wide
-- average for crypto too), so FIFO would produce numbers that do not match a
-- filed return. Fee-inclusive matters concretely: the PUST purchase of
-- 2026-06-01 is 2 x 104,74 = 209,48 ex-fee, while the cash that actually left
-- the account was 210,53. Excluding the fee understates the basis and so
-- overstates the displayed gain.
--
-- Set-returning rather than scalar, taking a day ARRAY, for the same reason
-- valuation_grid (0018/0019) is: the chart needs a basis per holding per
-- plotted day, and per-row scalar calls are what backfill.rs's own comments
-- record as 2.4 s of a 3.1 s statement. Callers that want one day pass a
-- one-element array, exactly as distribution() does against valuation_grid.
create function lot_basis(p_holding_ids uuid[], p_days date[])
returns table (holding_id uuid, as_of date, mean_price numeric,
               explained_qty numeric, basis numeric, realised numeric)
language sql
stable
-- Same reasoning as valuation_grid: the default 1000-row estimate makes the
-- planner nested-loop the callers' joins. A few hundred sampled days across a
-- dozen holdings is this order.
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
               -- Cash is a holding of a cash instrument valued at book: there
               -- is no mean buy price to speak of, exactly as today.
               when a.is_cash or m.mean_price is null then a.provider_basis
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
$$;
