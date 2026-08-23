//! Derive past holding values from transactions (TRANSACTIONS.md §8).
//!
//! Fills every (holding, day) that has no snapshot, walking quantity backward
//! from the nearest *later* snapshot — never from today, so drift stays bounded
//! inside one segment instead of accumulating across 3.5 years. Days after the
//! last snapshot get nothing: with no later anchor there is nothing to walk
//! from, and the sync stamps today anyway.
//!
//! Backward-walking needs no loop. quantity(d) is the anchor's quantity minus
//! every movement strictly after d up to and including the anchor day, which is
//! one correlated sum per day.
//!
//! ponytail: the whole connection is deleted and refilled every sync (~13k rows
//! for 3.5 years × 10 holdings). §8.3 describes a bounded invalidation instead;
//! the rewrite is smaller, always correct, and cheap at this size. Revisit if a
//! connection ever carries hundreds of holdings.
//! ponytail: runs inline in ingest; move to its own job if sync latency becomes
//! visible.

use uuid::Uuid;

use crate::error::CoreError;

/// Rewrites the derived history for every holding on `connection_id`.
/// Returns the number of derived rows written.
pub async fn backfill_connection(
    conn: &mut sqlx::PgConnection,
    connection_id: Uuid,
) -> Result<u64, CoreError> {
    sqlx::query!(
        r#"
        delete from holding_backfill hb
        using holding h
        join account a on a.id = h.account_id
        where hb.holding_id = h.id and a.connection_id = $1
        "#,
        connection_id,
    )
    .execute(&mut *conn)
    .await?;

    let written = sqlx::query!(
        r#"
        insert into holding_backfill (holding_id, as_of, quantity, value, cost_basis)
        with scope as (
            select h.id as holding_id, h.account_id, h.instrument_id,
                   i.kind = 'cash' as is_cash,
                   a.type_key = 'pea' as is_pea,
                   h.cost_basis as total_cost,
                   i.currency = a.currency as is_account_currency,
                   -- Whether this account's `booked_on` is a booking date at
                   -- all. Some connectors send the *statement period* instead,
                   -- stamping a whole fortnight onto the 1st or the 16th. The
                   -- tell is a row booked before it was spent, which cannot
                   -- happen: LIVRET A does it on 123 of 167 rows, CPT COURANT
                   -- never. Decided per account on every run, so a connector
                   -- that starts sending real dates is picked up on its own.
                   not exists (
                       select 1 from transaction t
                       where t.account_id = a.id
                         and t.booked_on < (t.ts at time zone 'utc')::date
                   ) as trust_booked_on
            from holding h
            join account a    on a.id = h.account_id
            join instrument i on i.id = h.instrument_id
            where a.connection_id = $1
        ),
        -- The horizon: as far back as *the whole user* has any evidence, plus
        -- one day so the flat rule-3 tail before the earliest movement is
        -- visible. Every holding is filled to the same date so a chart drawn
        -- over the whole range has a value for each of them (§3 rule 3 holds
        -- them flat).
        --
        -- User-wide, not connection-wide: the read-side lateral in
        -- net_worth_series is an inner join, so a holding contributes nothing
        -- before its first derived row. Powens connectors expose very different
        -- history depths (the PEA's is ~8 months, §2.2), so a per-connection
        -- horizon makes each bank pop into existence on its own date and steps
        -- net worth up as it does. §3 argues truncation-induced jumps are the
        -- worse failure; everything else here stays per-connection.
        --
        -- Scoped to the owner of $1 — never across users.
        owner as (
            select c.user_id from connection c where c.id = $1
        ),
        horizon as (
            select least(
                coalesce((select min(t.ts at time zone 'utc')::date from transaction t
                          join account a    on a.id = t.account_id
                          join connection c on c.id = a.connection_id
                          where c.user_id = (select user_id from owner)),
                         (now() at time zone 'utc')::date),
                coalesce((select min(hs.as_of) from holding_snapshot hs
                          join holding h    on h.id = hs.holding_id
                          join account a    on a.id = h.account_id
                          join connection c on c.id = a.connection_id
                          where c.user_id = (select user_id from owner)),
                         (now() at time zone 'utc')::date)
            ) - 1 as start_day
        ),
        -- Signed daily movement per holding, keyed on the day the *balance*
        -- moved (`booked_on`), not the day the user spent (`ts`). They disagree
        -- on 70% of real Powens rows by up to five days, and the walk anchors on
        -- the balance — keying on `ts` subtracts card spending before the
        -- balance reflected it, which drove derived cash negative on 1,753 days.
        -- `coalesce` keeps a provider that reports only one date working as before.
        --
        -- Cash moves by `amount`; a security
        -- moves by share count. On a PEA, transfer/buy/sell are excluded from
        -- the cash walk (§8.1): the PEA's history starts 2026-01-14 while the
        -- position predates it, so its buys have no matching transfer-in and a
        -- walk that counted them would drift by the whole unexplained basis.
        --
        -- `transaction` carries no currency, so `amount` is only meaningful for
        -- the cash holding whose instrument currency matches the account's own
        -- currency (the line the provider denominates `amount` in). A second
        -- cash holding on the same account, in another currency, gets no
        -- movement here and is held flat by §3 rule 3 until `transaction` grows
        -- a currency column to discriminate by.
        -- `materialized` is load-bearing: inlined, this aggregate was re-run once
        -- per derived row (9,072 times for 7 holdings × 3.5 years) instead of
        -- once. Same for `lots`. The two together, plus the JIT compilation the
        -- inflated cost estimate was triggering, were 2.4 s of a 3.1 s statement.
        moves as materialized (
            select s.holding_id, txn_day(s.trust_booked_on, t.booked_on, t.ts) as day,
                   sum(case
                       when s.is_cash then t.amount
                       when t.type = 'buy'  then coalesce(t.quantity, 0)
                       when t.type = 'sell' then -coalesce(t.quantity, 0)
                       else 0
                   end) as delta
            from scope s
            join transaction t on t.account_id = s.account_id
            where (not s.is_cash or not (s.is_pea and t.type in ('transfer', 'buy', 'sell')))
              and (s.is_cash or t.instrument_id = s.instrument_id)
              and (not s.is_cash or s.is_account_currency)
            group by s.holding_id, txn_day(s.trust_booked_on, t.booked_on, t.ts)
        ),
        -- §8.2: the same per-day shape as `moves`, for buy lots.
        lots as materialized (
            select s.holding_id, txn_day(s.trust_booked_on, t.booked_on, t.ts) as day,
                   sum(t.quantity * t.unit_price) as cost
            from scope s
            join transaction t on t.account_id = s.account_id
                              and t.instrument_id = s.instrument_id
            where t.type = 'buy'
              and t.quantity is not null and t.unit_price is not null
            group by s.holding_id, txn_day(s.trust_booked_on, t.booked_on, t.ts)
        ),
        days as (
            select s.holding_id, gs::date as as_of
            from scope s
            cross join horizon hz
            cross join lateral generate_series(
                hz.start_day, (now() at time zone 'utc')::date, '1 day') gs
        ),
        -- Only days with no snapshot, each paired with the first snapshot after
        -- it. A day past the last snapshot has no anchor and drops out here.
        -- The `not exists` is what keeps the holding_point invariant from this
        -- side: stamp_snapshot deletes a colliding backfill row, and this never
        -- writes one for a day that already has a snapshot.
        gaps as (
            select d.holding_id, d.as_of, nx.as_of as anchor_day,
                   nx.quantity as anchor_qty,
                   uv.quantity as unit_qty, uv.value as unit_value
            from days d
            join lateral (
                select hs.as_of, hs.quantity
                from holding_snapshot hs
                where hs.holding_id = d.holding_id and hs.as_of > d.as_of
                order by hs.as_of
                limit 1
            ) nx on true
            -- The per-unit valuation carried onto this day comes from the
            -- nearest snapshot that actually holds something, looking later
            -- first and only then earlier. The quantity anchor above must stay
            -- the nearest *later* snapshot, but a zero-quantity anchor carries
            -- no per-unit information: for a fully-sold position every later
            -- snapshot is zero, so the search has to reach back past the sale
            -- or the held window would be valued at nothing.
            left join lateral (
                select hs.quantity, hs.value
                from holding_snapshot hs
                where hs.holding_id = d.holding_id and hs.quantity <> 0
                order by hs.as_of <= d.as_of, abs(hs.as_of - d.as_of)
                limit 1
            ) uv on true
            where not exists (
                select 1 from holding_snapshot hs
                where hs.holding_id = d.holding_id and hs.as_of = d.as_of
            )
        ),
        walked as (
            select g.holding_id, g.as_of, g.anchor_day, s.is_cash,
                   g.unit_qty, g.unit_value,
                   g.anchor_qty - coalesce((
                       select sum(m.delta) from moves m
                       where m.holding_id = g.holding_id
                         and m.day > g.as_of and m.day <= g.anchor_day
                   ), 0) as quantity,
                   -- §8.2: known lots up to this day, plus the basis no lot
                   -- explains, carried flat backward until the user fills it in.
                   s.total_cost - coalesce((
                       select sum(l.cost) from lots l
                       where l.holding_id = g.holding_id and l.day > g.as_of
                   ), 0) as cost_basis
            from gaps g
            join scope s on s.holding_id = g.holding_id
        ),
        -- Nothing owned can be a negative amount, yet 2,435 derived days were:
        -- the earliest snapshot anchors every day before it, so a
        -- reconciliation gap on that one day becomes a constant bias over the
        -- whole history. Revolut's first snapshot sits 10.00 under its own
        -- ledger (one card payment the balance had taken and the connector had
        -- not yet booked) and that 10.00 is the entire negative population.
        -- The PEA's is the 6.63 dividend that §8.1 still counts, walked back
        -- from a 0.45 balance.
        --
        -- The error is a constant, so each anchored stretch that dips below
        -- zero is raised by its own shortfall. The shape of the line survives
        -- exactly — every step stays where it was — and what it costs is a
        -- discontinuity of at most the shortfall where the stretch meets its
        -- anchor. That beats a line sitting under zero for 1,221 days.
        --
        -- Per stretch, not per holding: a gap between two sound snapshots must
        -- not be dragged up by a shortfall on some older one.
        --
        -- ponytail: this treats the shortfall as an unknown opening balance and
        -- spreads it flat. Attributing it to the transaction that actually went
        -- missing would be exact, but nothing in the ledger says which one.
        lifted as (
            select w.*,
                   greatest(0, -min(w.quantity) over (
                       partition by w.holding_id, w.anchor_day
                   )) as lift
            from walked w
        )
        select w.holding_id, w.as_of, w.quantity + w.lift,
               -- `value` is only the fallback branch of the read-side valuation
               -- (quantity × unit_value_asof wins whenever a price exists), so
               -- it matters solely for an instrument with no price row at all.
               -- Cash mirrors the sync's convention; a security carries the
               -- nearest valued snapshot's per-unit valuation flat onto this day
               -- (§3 rule 3 applied to price), because writing 0 here would make
               -- the chart dip to zero on every derived day and raise fx_missing
               -- spuriously. Multiply before dividing so a day whose quantity is
               -- unchanged reproduces the snapshot's value exactly, and divide by
               -- NULL (not by zero) when no valued snapshot exists at all — the
               -- row then falls back to its own cost basis, the usual convention
               -- when no market value is available.
               case
                   when w.is_cash then w.quantity + w.lift
                   else coalesce(
                       (w.quantity + w.lift) * w.unit_value / nullif(w.unit_qty, 0),
                       w.cost_basis
                   )
               end,
               case when w.is_cash then w.quantity + w.lift else w.cost_basis end
        from lifted w
        "#,
        connection_id,
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();

    Ok(written)
}
