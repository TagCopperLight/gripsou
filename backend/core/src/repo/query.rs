//! Read-side aggregations for the dashboard, all scoped by user_id
//! (joined via connection.user_id). Money stays Decimal end-to-end.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

pub struct NetWorthRow {
    pub as_of: NaiveDate,
    pub net_worth: Decimal,
    pub invested: Decimal,
    /// At least one holding on this day had no FX rate, so it was valued at
    /// zero or its cost basis was left out of `invested`.
    pub fx_missing: bool,
    /// The reader's reporting currency had no rate on this day, so the figures
    /// are still denominated in the pivot rather than converted. Distinct from
    /// `fx_missing`: nothing is *missing* from the sum, the whole sum is in the
    /// wrong currency.
    pub reporting_fx_missing: bool,
}

pub async fn net_worth_series(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<NetWorthRow>, CoreError> {
    net_worth_series_with_target(
        pool,
        user_id,
        from,
        to,
        crate::repo::series::CHART_TARGET_POINTS,
    )
    .await
}

/// Same as [`net_worth_series`] but with the sample target exposed. Exists so
/// the golden sampling tests (`tests/golden.rs`) can force a small target
/// against the fixed-size seeded scenario, which is otherwise too short to
/// ever produce a stride above 1. Not part of the public API.
#[doc(hidden)]
pub async fn net_worth_series_with_target(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
    target: usize,
) -> Result<Vec<NetWorthRow>, CoreError> {
    // Clamp to real history, then sample. `range=max` asks for 4000 days
    // regardless of how much exists, and a 4000-point line is drawn into about
    // 800 pixels.
    let start = crate::repo::series::history_start(pool, user_id)
        .await?
        .map_or(from, |h| h.max(from));
    let days = crate::repo::series::sample_days(start, to, target);

    let rows = sqlx::query_as!(
        NetWorthRow,
        r#"
        -- Per day, value each holding from its as-of snapshot (quantity anchor)
        -- and valuation_grid's unit_value, which folds in the FX rate. The INNER JOIN LATERAL
        -- excludes a holding on days before its first snapshot (no row) — so a
        -- position never contributes before it was acquired. A sold holding keeps
        -- its history (its zero snapshot values it at 0 thereafter). Falling back
        -- to the provider valuation (snap.value) still needs converting, hence
        -- the account-currency rate (afx) on that branch. Everything is summed in the pivot,
        -- then divided once into the reader's reporting currency.
        --
        -- Three currency domains, never conflated:
        --   price     — the `price` row's own currency, folded in by
        --               valuation_grid (it reads the price row, not the
        --               instrument);
        --   amount    — `account.currency`, which is what the provider denominates
        --               snapshot.value in, hence the afx join on that branch;
        --   reporting — `users.prefs.currency`, applied once by the final divide.
        -- `instrument.currency` is the quote currency of the security and is none
        -- of the three: a USD-quoted stock inside a EUR account has a EUR cost
        -- basis.
        --
        -- A holding whose rate is unknown contributes NULL, which sum() skips —
        -- i.e. it is valued at zero — and raises fx_missing so the UI can say so.
        -- The flag is raised on the failure itself (both value branches NULL),
        -- not on any one currency, and only for a position actually held that day
        -- so a sold foreign holding does not leave a permanent warning with no
        -- row behind it.
        --
        -- The `dates` array is not every day in the range: see repo::series,
        -- whose `sample_days` clamps the axis to real history and samples it
        -- down to roughly CHART_TARGET_POINTS points before this query ever
        -- runs.
        with dates as (
            select distinct unnest($2::date[]) as as_of
        ),
        -- One valuation per instrument-day instead of one per holding-day, with
        -- the FX lookup folded into the same scan. `materialized` is load-bearing
        -- on all three: an inlined CTE here gets re-executed per outer row.
        grid as materialized (select * from valuation_grid($1, $2)),
        fx   as materialized (select as_of, currency, unit_value from grid where kind = 'cash'),
        rep  as materialized (
            select as_of, unit_value from fx
            where currency = coalesce((select prefs->>'currency' from users where id = $1), 'EUR')
        ),
        -- The invested line, from the one definition (0022). `materialized` for
        -- the same reason the grid is: inlined, this would be re-executed per
        -- outer row.
        lb as materialized (
            select * from lot_basis(
                array(
                    select h.id
                    from holding h
                    join account a    on a.id = h.account_id
                    join connection c on c.id = a.connection_id
                    where c.user_id = $1
                ),
                $2
            )
        )
        select d.as_of as "as_of!",
               coalesce(sum(coalesce(
                   snap.quantity * uv.unit_value,
                   snap.value * afx.unit_value,
                   0
               )), 0) / coalesce(nullif(rep.unit_value, 0), 1) as "net_worth!",
               -- Per-row coalesce, not one around the sum: without it a single
               -- holding whose account currency has no rate turns its own term
               -- NULL, sum() skips it, and the invested line silently loses that
               -- position's basis while net worth still counts it — a fabricated
               -- gain with nothing on screen to explain it. The row is worth
               -- zero here and says so through fx_missing below.
               coalesce(sum(coalesce(lb.basis * afx.unit_value, 0)), 0)
                   / coalesce(nullif(rep.unit_value, 0), 1) as "invested!",
               coalesce(bool_or(
                   (snap.quantity <> 0
                    and uv.unit_value is null
                    and coalesce(snap.value * afx.unit_value, 0) = 0)
                   -- The basis failure is its own case: a position can be
                   -- perfectly priceable (uv resolves) while the account's own
                   -- rate is unknown, in which case the value branch above is
                   -- false and only this one fires.
                   or (lb.basis <> 0 and afx.unit_value is null)
               ), false) as "fx_missing!",
               reporting_fx_degraded($1, d.as_of) as "reporting_fx_missing!"
        from dates d
        cross join holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        -- INNER join: an instrument with no grid row cannot be valued at all.
        join grid uv      on uv.instrument_id = h.instrument_id and uv.as_of = d.as_of
        left join fx afx  on afx.as_of = d.as_of and afx.currency = a.currency
        left join rep     on rep.as_of = d.as_of
        left join lb      on lb.holding_id = h.id and lb.as_of = d.as_of
        -- `holding_point` is holding_snapshot ∪ holding_backfill. The invariant
        -- (§4, enforced by stamp_snapshot) is that no day carries both, so the
        -- union needs no precedence rule: synced truth simply exists where it
        -- exists, and derived values fill the rest.
        join lateral (
            select hs.quantity, hs.value
            from holding_point hs
            where hs.holding_id = h.id and hs.as_of <= d.as_of
            order by hs.as_of desc
            limit 1
        ) snap on true
        where c.user_id = $1
        group by d.as_of, rep.unit_value
        order by d.as_of
        "#,
        user_id,
        &days,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct HoldingRow {
    pub holding_id: Uuid,
    pub symbol: Option<String>,
    pub instrument_name: String,
    pub kind: String,
    pub logo_url: Option<String>,
    /// The instrument's own currency — the currency the security is *quoted* in.
    /// Not the currency of any amount on this row.
    pub currency: String,
    /// Currency of the `price` row `price` came from — the price domain. May
    /// differ from `currency` (Powens labels an instrument EUR, Yahoo resolves a
    /// London listing quoted GBP). NULL when there is no price row.
    pub price_currency: Option<String>,
    /// The account's currency — the amount domain. `cost_basis`,
    /// `invested_native`, snapshot values and transaction amounts are all in it.
    pub account_currency: String,
    pub account_id: Uuid,
    pub account_name: String,
    pub account_color: Option<String>,
    /// Stable account-type key (`checking`, `pea`, …); the frontend translates
    /// it, falling back to `type_label`.
    pub type_key: String,
    /// English account-type label from the reference table — the i18n fallback.
    pub type_label: String,
    pub quantity: Decimal,
    /// Latest unit price, in `price_currency` (NOT `currency`).
    pub price: Option<Decimal>,
    /// Last 30 daily unit prices, ascending by time. Empty if none.
    pub spark: Vec<Decimal>,
    /// ETF/fund country and sector breakdown, when available in instrument.meta.
    pub composition: Option<crate::dto::Composition>,
    /// Position value in the reader's reporting currency. Zero when the rate is
    /// unknown (see `fx_missing`).
    pub value: Decimal,
    /// Cost basis in the reader's reporting currency.
    pub invested: Decimal,
    /// Cost basis in the *account's* currency — the amount-domain figure, which
    /// is what the provider denominated it in. Label it with `account_currency`,
    /// never with `currency` or `price_currency`.
    pub invested_native: Decimal,
    /// Neither valuation branch resolved (no usable price and no convertible
    /// snapshot value), so `value` reads zero.
    pub fx_missing: bool,
    /// Shares no recorded lot explains: `quantity − Σ buys + Σ sells` (§9.1).
    /// Signed: positive means shares no lot explains, negative means more is
    /// recorded than held (an unrecorded sale). Non-zero means the cost basis
    /// and the pre-purchase history are guesses, which the Holdings badge says
    /// out loud. Always zero for cash — a cash line has nothing to explain.
    pub unexplained_quantity: Decimal,
    /// Fee-inclusive mean buy price, amount domain (account currency). Zero
    /// when no buys are recorded. Exported so the frontend can draw the
    /// invested line without reimplementing the basis rule.
    pub mean_price: Decimal,
    /// The part of the basis no recorded lot explains, amount domain. Zero when
    /// the lots account for the position exactly.
    pub unexplained_cost: Decimal,
}

pub async fn holdings(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<HoldingRow>, CoreError> {
    struct Base {
        holding_id: Uuid,
        symbol: Option<String>,
        instrument_name: String,
        kind: String,
        logo_url: Option<String>,
        currency: String,
        price_currency: Option<String>,
        account_currency: String,
        instrument_id: Uuid,
        account_id: Uuid,
        account_name: String,
        account_color: Option<String>,
        type_key: String,
        type_label: String,
        quantity: Decimal,
        price: Option<Decimal>,
        composition: Option<serde_json::Value>,
        value: Decimal,
        invested: Decimal,
        invested_native: Decimal,
        fx_missing: bool,
        unexplained_quantity: Decimal,
        mean_price: Decimal,
        unexplained_cost: Decimal,
    }

    let bases = sqlx::query_as!(
        Base,
        r#"
        -- Same valuation rule as net_worth_series/accounts/distribution: price
        -- first, provider valuation (converted from the ACCOUNT's currency)
        -- second, zero last. Without the snapshot fallback this table would show
        -- 0 for an instrument with no usable price while the accounts card, the
        -- pie and the net-worth chart all showed the provider valuation — on the
        -- same screen. The lateral is LEFT because a holding ingested before its
        -- first snapshot must still list (it just has no fallback).
        --
        -- `price` is the price ROW's unit price and carries that row's own
        -- currency (`price_currency`), which is not necessarily i.currency.
        -- `invested`/`invested_native` are amount-domain and therefore convert
        -- from a.currency, not i.currency.
        with today as (select (now() at time zone 'utc')::date as d)
        select h.id            as "holding_id!",
               -- Display ticker, not the identity column. `symbol` is null on
               -- the ISIN path (ISIN is the identity there, and tickers are not
               -- globally unique), so the resolved Yahoo ticker in meta is what
               -- the user should see. Cash is excluded: its meta holds an FX
               -- pair like `CNYEUR=X`, a fetch detail, and the UI falls back to
               -- the ISO code.
               coalesce(
                   i.symbol,
                   case when i.kind <> 'cash' then i.meta->>'yahoo_symbol' end
               )               as "symbol",
               i.name          as "instrument_name!",
               i.kind          as "kind!",
               i.logo_url,
               i.meta->'composition' as "composition?",
               i.currency      as "currency!",
               px.currency     as "price_currency?",
               a.currency      as "account_currency!",
               i.id            as "instrument_id!",
               a.id            as "account_id!",
               a.name          as "account_name!",
               a.color         as "account_color",
               a.type_key      as "type_key!",
               t.label         as "type_label!",
               h.quantity      as "quantity!",
               px.unit_price   as "price?",
               coalesce(
                   h.quantity * unit_value_asof(i.id, (select d from today)),
                   snap.value * fx_asof(a.currency, (select d from today)),
                   0
               ) / reporting_fx_asof($1, (select d from today)) as "value!",
               -- Read-time only — nothing is written, so a resync cannot
               -- clobber this and no migration is involved. The rule itself
               -- lives in `lot_basis` (0022); these two columns only convert it.
               coalesce(lot.basis * fx_asof(a.currency, (select d from today)), 0)
                   / reporting_fx_asof($1, (select d from today)) as "invested!",
               lot.basis      as "invested_native!",
               lot.mean_price       as "mean_price!",
               lot.unexplained_cost as "unexplained_cost!",
               -- Two separate failures, one flag: the position could not be
               -- valued at all, OR it is priceable but its account's currency
               -- has no rate, so `invested` above coalesced to zero. The second
               -- used to pass unflagged, showing a real value against a zero
               -- cost basis and an invented gain.
               ((unit_value_asof(i.id, (select d from today)) is null
                 and coalesce(snap.value * fx_asof(a.currency, (select d from today)), 0) = 0)
                or (coalesce(lot.basis, 0) <> 0
                    and fx_asof(a.currency, (select d from today)) is null))
                   as "fx_missing!",
               -- §9.1: shares no recorded lot explains. Scoped to THIS holding's
               -- (account, instrument) via the `lot` lateral — never the
               -- instrument alone, or another user's buy of the same ETF would
               -- reduce this figure (the exact cross-user bug already found and
               -- fixed in the backfill engine).
               --
               -- SIGNED, deliberately: negative means more is recorded than is
               -- held. Flooring it at zero made that state invisible, so the
               -- user was never told and could never open the modal to fix it.
               case when i.kind = 'cash' then 0
                    else h.quantity - coalesce(lot.explained_qty, 0)
               end as "unexplained_quantity!"
        from holding h
        join account a      on a.id = h.account_id
        join connection c   on c.id = a.connection_id
        join instrument i   on i.id = h.instrument_id
        join account_type t on t.key = a.type_key
        left join lateral (
            select p.unit_price, p.currency
            from price p
            where p.instrument_id = i.id
            order by p.ts desc
            limit 1
        ) px on true
        left join lateral (
            select hs.value
            from holding_snapshot hs
            where hs.holding_id = h.id
            order by hs.as_of desc
            limit 1
        ) snap on true
        left join lateral (
            -- THE basis rule, called not reimplemented. Everything §4.3 used to
            -- say inline now lives in lot_basis (0022), so the holdings table,
            -- the chart and the modal preview cannot drift apart again.
            --
            -- `unexplained_cost` is exported so the asset modal can draw its
            -- invested line as mean_price x qty(t) + unexplained_cost — a
            -- multiplication, not a rule. That is what lets the frontend stop
            -- implementing the formula.
            select coalesce(b.mean_price, 0) as mean_price,
                   b.explained_qty,
                   b.basis,
                   b.basis - coalesce(b.mean_price, 0) * b.explained_qty as unexplained_cost
            from lot_basis(array[h.id], array[(select d from today)]) b
        ) lot on true
        where c.user_id = $1 and h.quantity <> 0
        order by h.id
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(bases.len());
    for b in bases {
        // Cash rows show no sparkline (their "prices" are FX rates), so don't
        // pay for the query.
        // The last 30 *days*, not the last 30 rows: a row count silently covers a
        // different window whenever the feed's cadence changes, so the "30D"
        // label stops meaning 30D. A market instrument yields ~21 points here
        // (weekends have no price), which is the honest shape.
        //
        // ponytail: no cap on the row count. A daily feed makes this ~30 rows;
        // add a sample-down (repo::series) if an intraday feed ever lands here.
        let spark: Vec<Decimal> = if b.kind == "cash" {
            Vec::new()
        } else {
            sqlx::query_scalar!(
                r#"
                select unit_price as "unit_price!"
                from price
                where instrument_id = $1
                  and ts >= now() - interval '30 days'
                order by ts
                "#,
                b.instrument_id,
            )
            .fetch_all(pool)
            .await?
        };

        out.push(HoldingRow {
            holding_id: b.holding_id,
            symbol: b.symbol,
            instrument_name: b.instrument_name,
            kind: b.kind,
            logo_url: b.logo_url,
            currency: b.currency,
            price_currency: b.price_currency,
            account_currency: b.account_currency,
            account_id: b.account_id,
            account_name: b.account_name,
            account_color: b.account_color,
            type_key: b.type_key,
            type_label: b.type_label,
            quantity: b.quantity,
            price: b.price,
            spark,
            composition: b.composition.and_then(|v| serde_json::from_value(v).ok()),
            value: b.value,
            invested: b.invested,
            invested_native: b.invested_native,
            fx_missing: b.fx_missing,
            unexplained_quantity: b.unexplained_quantity,
            mean_price: b.mean_price,
            unexplained_cost: b.unexplained_cost,
        });
    }
    Ok(out)
}

pub struct PricePointRow {
    pub ts: DateTime<Utc>,
    pub unit_price: Decimal,
}

pub async fn holding_prices(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    holding_id: Uuid,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<PricePointRow>, CoreError> {
    let rows = sqlx::query_as!(
        PricePointRow,
        r#"
        select p.ts as "ts!", p.unit_price as "unit_price!"
        from price p
        join holding h    on h.instrument_id = p.instrument_id
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1 and c.user_id = $2 and p.ts between $3 and $4
        order by p.ts
        "#,
        holding_id,
        user_id,
        from,
        to,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct AccountRow {
    pub account_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub type_key: String,
    pub type_label: String,
    pub value: Decimal,
    pub fx_missing: bool,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub institution_key: Option<String>,
    pub source_name: Option<String>,
}

/// One row per account: latest snapshot value per holding, summed, with the
/// account-type label and the connection's last sync time.
pub async fn accounts(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<AccountRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountRow,
        r#"
        -- Value each holding from its latest snapshot's quantity and the
        -- instrument's unit value (FX included), falling back to the provider
        -- valuation converted at the account-currency rate — the same rule as
        -- net_worth_series, so the accounts grid sums to the chart's current
        -- figure. `hs.value` is amount-domain (the provider denominates it in
        -- the account's currency), hence the afx join — not the instrument's
        -- quote currency. fx_missing flags the actual failure (neither branch
        -- resolved) on a still-held position, matching holdings()'s
        -- `h.quantity <> 0`.
        --
        -- Valued through `valuation_grid` rather than the scalar
        -- unit_value_asof/fx_asof/reporting_fx_asof functions, for the reason
        -- spelled out on distribution() — with one extra twist that made this
        -- query the worst of the three. The scalars sit in the select list of a
        -- `distinct on`, and Postgres projects *before* it uniquifies: every
        -- historical snapshot row got priced (four lookups each), then all but
        -- the newest per holding was discarded. That cost grows by one row per
        -- holding per day forever while the result stays the same size. Joining
        -- the grid instead makes the per-row work a hash probe, so the pricing
        -- is proportional to what is owned, not to how long it has been owned.
        --
        -- Measured on the dev database (13 holdings, 197 snapshots): 58.7 ms ->
        -- 2.9 ms, byte-identical output.
        --
        -- The grid joins are LEFT on purpose: a missing row must leave
        -- unit_value NULL so the coalesce falls through to the provider
        -- valuation, exactly as a NULL from unit_value_asof did. `rep`
        -- reproduces reporting_fx_asof's own coalesce(nullif(rate, 0), 1) —
        -- no usable rate means report in the pivot rather than 500 on a
        -- division by zero.
        with today as (select (now() at time zone 'utc')::date as d),
        grid as materialized (
            select * from valuation_grid($1, array[(select d from today)]::date[])
        ),
        fx  as materialized (select currency, unit_value from grid where kind = 'cash'),
        rep as materialized (
            select unit_value from fx
            where currency = coalesce((select prefs->>'currency' from users where id = $1), 'EUR')
        ),
        latest as (
            select distinct on (hs.holding_id)
                   hs.holding_id,
                   coalesce(
                       hs.quantity * uv.unit_value,
                       hs.value * afx.unit_value,
                       0
                   ) as value,
                   h.quantity <> 0
                   and uv.unit_value is null
                   and coalesce(hs.value * afx.unit_value, 0) = 0
                       as fx_missing
            from holding_snapshot hs
            join holding h    on h.id = hs.holding_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
            join instrument i on i.id = h.instrument_id
            left join grid uv on uv.instrument_id = i.id
            left join fx afx  on afx.currency = a.currency
            where c.user_id = $1
            order by hs.holding_id, hs.as_of desc
        )
        select a.id    as "account_id!",
               a.name  as "name!",
               a.color,
               a.type_key as "type_key!",
               t.label as "type_label!",
               sum(l.value) / coalesce(nullif((select unit_value from rep), 0), 1) as "value!",
               coalesce(bool_or(l.fx_missing), false) as "fx_missing!",
               c.last_sync_at,
               c.institution_key,
               coalesce(c.institution_name, p.display_name) as source_name
        from latest l
        join holding h      on h.id = l.holding_id
        join account a      on a.id = h.account_id
        join account_type t on t.key = a.type_key
        join connection c   on c.id = a.connection_id
        join provider p     on p.key = c.provider_key
        group by a.id, a.name, a.color, a.type_key, t.label, c.last_sync_at, c.institution_key, c.institution_name, p.display_name
        order by sum(l.value) desc
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct AccountSeriesRow {
    pub account_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub as_of: NaiveDate,
    pub value: Decimal,
}

/// Stacked-area source: snapshot value summed per (account, day) over a window.
pub async fn account_series(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<AccountSeriesRow>, CoreError> {
    account_series_with_target(
        pool,
        user_id,
        from,
        to,
        crate::repo::series::CHART_TARGET_POINTS,
    )
    .await
}

/// Same as [`account_series`] but with the sample target exposed — see
/// [`net_worth_series_with_target`] for why this seam exists. Not part of the
/// public API.
#[doc(hidden)]
pub async fn account_series_with_target(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
    target: usize,
) -> Result<Vec<AccountSeriesRow>, CoreError> {
    let start = crate::repo::series::history_start(pool, user_id)
        .await?
        .map_or(from, |h| h.max(from));
    let days = crate::repo::series::sample_days(start, to, target);

    let rows = sqlx::query_as!(
        AccountSeriesRow,
        r#"
        -- Same valuation as net_worth_series (snapshot-anchored quantity via the
        -- lateral join + valuation_grid), grouped per account for the
        -- stacked area. No fx_missing flag: the accounts grid already surfaces it.
        with dates as (
            select distinct unnest($2::date[]) as as_of
        ),
        grid as materialized (select * from valuation_grid($1, $2)),
        fx   as materialized (select as_of, currency, unit_value from grid where kind = 'cash'),
        rep  as materialized (
            select as_of, unit_value from fx
            where currency = coalesce((select prefs->>'currency' from users where id = $1), 'EUR')
        )
        select a.id   as "account_id!",
               a.name as "name!",
               a.color as "color",
               d.as_of as "as_of!",
               coalesce(sum(coalesce(
                   snap.quantity * uv.unit_value,
                   snap.value * afx.unit_value,
                   0
               )), 0) / coalesce(nullif(rep.unit_value, 0), 1) as "value!"
        from dates d
        cross join holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        join grid uv      on uv.instrument_id = h.instrument_id and uv.as_of = d.as_of
        left join fx afx  on afx.as_of = d.as_of and afx.currency = a.currency
        left join rep     on rep.as_of = d.as_of
        join lateral (
            select hs.quantity, hs.value
            from holding_point hs
            where hs.holding_id = h.id and hs.as_of <= d.as_of
            order by hs.as_of desc
            limit 1
        ) snap on true
        where c.user_id = $1
        group by a.id, a.name, a.color, d.as_of, rep.unit_value
        order by d.as_of, a.id
        "#,
        user_id,
        &days,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct AccountTypeRow {
    pub key: String,
    pub label: String,
}

/// All account types from the reference table, ordered by label. New types are
/// data inserts here — no code change needed to surface them in the
/// edit-account dropdown.
pub async fn account_types(pool: &sqlx::PgPool) -> Result<Vec<AccountTypeRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountTypeRow,
        r#"
        select t.key   as "key!",
               t.label as "label!"
        from account_type t
        order by t.label
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct UserRow {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
    pub avatar: Option<String>,
}

/// Every user on the server, oldest first (the seeded admin sorts first).
/// Global, not user-scoped: the admin Users page lists everyone.
pub async fn users(pool: &sqlx::PgPool) -> Result<Vec<UserRow>, CoreError> {
    let rows = sqlx::query_as!(
        UserRow,
        r#"
        select id, name, email, role, created_at, prefs->>'avatar' as avatar
        from users
        order by created_at
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct DistributionRow {
    pub account_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub type_key: String,
    pub type_label: String,
    pub value: Decimal,
    /// At least one still-held holding in this slice could not be valued, so the
    /// slice is understated.
    pub fx_missing: bool,
}

pub async fn distribution(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<DistributionRow>, CoreError> {
    let rows = sqlx::query_as!(
        DistributionRow,
        r#"
        -- Same per-holding valuation as accounts()/net_worth_series so the pie
        -- sums to the net-worth figure.
        --
        -- Valued through `valuation_grid` rather than the scalar
        -- unit_value_asof/fx_asof/reporting_fx_asof functions. The scalars are
        -- fine for a single lookup, but this query made several per holding —
        -- unit_value_asof and fx_asof twice each (once for the value, once for
        -- the fx_missing test) and reporting_fx_asof twice more (select and
        -- order by) — each one a planned index seek with a nested fx lookup
        -- inside it. That was 33 ms of a 35 ms statement.
        --
        -- The grid computes the same arithmetic once per instrument instead of
        -- once per holding, and folds the FX lookup into the same scan. Unlike
        -- the chart series this needs a single day, so there is no sampling and
        -- no day axis to keep in step — just a one-element array.
        --
        -- The joins are LEFT on purpose: a missing grid row must leave
        -- unit_value NULL so the coalesce falls through to the provider
        -- valuation, exactly as a NULL from unit_value_asof did.
        with today as (select (now() at time zone 'utc')::date as d),
        grid as materialized (
            select * from valuation_grid($1, array[(select d from today)]::date[])
        ),
        fx  as materialized (select currency, unit_value from grid where kind = 'cash'),
        rep as materialized (
            select unit_value from fx
            where currency = coalesce((select prefs->>'currency' from users where id = $1), 'EUR')
        ),
        latest as (
            select distinct on (hs.holding_id)
                   hs.holding_id,
                   coalesce(
                       hs.quantity * uv.unit_value,
                       hs.value * afx.unit_value,
                       0
                   ) as value,
                   h.quantity <> 0
                   and uv.unit_value is null
                   and coalesce(hs.value * afx.unit_value, 0) = 0
                       as fx_missing
            from holding_snapshot hs
            join holding h    on h.id = hs.holding_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
            join instrument i on i.id = h.instrument_id
            left join grid uv on uv.instrument_id = i.id
            left join fx afx  on afx.currency = a.currency
            where c.user_id = $1
            order by hs.holding_id, hs.as_of desc
        )
        select a.id   as "account_id!",
               a.name as "name!",
               a.color,
               a.type_key as "type_key!",
               t.label    as "type_label!",
               sum(l.value) / coalesce(nullif((select unit_value from rep), 0), 1) as "value!",
               coalesce(bool_or(l.fx_missing), false) as "fx_missing!"
        from latest l
        join holding h      on h.id = l.holding_id
        join account a      on a.id = h.account_id
        join account_type t on t.key = a.type_key
        group by a.id, a.name, a.color, a.type_key, t.label
        order by sum(l.value) / coalesce(nullif((select unit_value from rep), 0), 1) desc
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct TransactionListRow {
    pub id: Uuid,
    pub ts: DateTime<Utc>,
    pub kind: String,
    pub description: Option<String>,
    /// In `account_currency` — the amount domain, as the provider sent it. Not
    /// converted: the list shows what actually moved in the account.
    pub amount: Decimal,
    /// `"cash"` for a `transaction` row, `"lot"` for a purchase/sale that now
    /// lives in the `lot` table. Structured, not a pre-built sentence: the
    /// frontend's i18n and per-user number formatting render the lot fields.
    pub source: String,
    pub ticker: Option<String>,
    pub quantity: Option<Decimal>,
    pub unit_price: Option<Decimal>,
    pub fee: Option<Decimal>,
    pub account_id: Uuid,
    pub account_name: String,
    pub account_color: Option<String>,
    pub account_currency: String,
}

#[derive(Debug, Clone)]
pub struct TransactionFilters {
    /// Case-insensitive substring of `description` (cash rows) or `ticker`
    /// (lot rows).
    pub search: Option<String>,
    pub account_id: Option<Uuid>,
    pub kind: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub limit: i64,
    pub offset: i64,
}

/// The Transactions page (§10). Every filter is optional and applied with the
/// `$n is null or ...` idiom so one prepared statement covers all combinations —
/// no query builder, and the macro still checks it at compile time.
pub async fn transactions(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    f: &TransactionFilters,
) -> Result<Vec<TransactionListRow>, CoreError> {
    let rows = sqlx::query_as!(
        TransactionListRow,
        r#"
        with rows as (
            select t.id, t.ts, t.type as kind, t.description, t.amount,
                   'cash'::text as source,
                   null::text as ticker, null::numeric as quantity,
                   null::numeric as unit_price, null::numeric as fee,
                   a.id as account_id, a.name as account_name,
                   a.color as account_color, a.currency as account_currency
            from transaction t
            join account a    on a.id = t.account_id
            join connection c on c.id = a.connection_id
            where c.user_id = $1
              -- Mirrors §8.1's cash-walk exclusion, for the same reason: a
              -- transfer into the PEA is the other half of an outflow already
              -- listed on the checking account, and a provider buy is the
              -- cash leg of a purchase the lot branch below already lists.
              -- Unconditional — these rows are not filterable, they are
              -- unreachable through this endpoint.
              --
              -- Scoped to provider rows via `external_id is not null`: there
              -- are no manual buy/sell rows in `transaction` any more (they
              -- moved to `lot`), so the user's own purchases now arrive
              -- through the lot branch of the union instead.
              and not (a.type_key = 'pea'
                       and t.external_id is not null
                       and t.type in ('transfer', 'buy', 'sell'))

            union all

            -- Lots reach the list as structured rows, not pre-built sentences,
            -- so the frontend's i18n and per-user number formatting render them.
            -- A buy's amount is -(qty x price + fee); a sale's is
            -- +(qty x price - fee). That is the real cash impact either way.
            select l.id,
                   (l.acquired_on::timestamp at time zone 'UTC') as ts,
                   l.side as kind,
                   null::text as description,
                   case when l.side = 'buy' then -(l.quantity * l.unit_price + l.fee)
                        else l.quantity * l.unit_price - l.fee end as amount,
                   'lot'::text as source,
                   -- `resolve_instrument` stores `symbol` as null whenever an
                   -- ISIN identifies the row (ISINs are the identity there;
                   -- ticker symbols collide across exchanges), which is the
                   -- common case for PEA holdings. Fall back through isin
                   -- before the instrument name so the list still shows a
                   -- short, identifying label rather than "Apple Inc.".
                   coalesce(i.symbol, i.isin, i.name) as ticker,
                   l.quantity, l.unit_price, l.fee,
                   a.id, a.name, a.color, a.currency
            from lot l
            join holding h    on h.id = l.holding_id
            join instrument i on i.id = h.instrument_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
            where c.user_id = $1
        )
        select id as "id!", ts as "ts!", kind as "kind!", description, amount as "amount!",
               source as "source!", ticker, quantity, unit_price, fee,
               account_id as "account_id!", account_name as "account_name!",
               account_color, account_currency as "account_currency!"
        from rows
        where ($2::text is null
               or description ilike '%' || $2 || '%'
               -- Lot rows carry no `description` (it's null, see the union
               -- above) but the list shows their `ticker`, and that's what a
               -- user searching for a purchase naturally types. Both sides
               -- stay nullable-safe: `ilike` against a null column is null,
               -- which the `or` just drops.
               or ticker ilike '%' || $2 || '%')
          and ($3::uuid is null or account_id = $3)
          and ($4::text is null or kind = $4)
          and ($5::date is null or (ts at time zone 'utc')::date >= $5)
          and ($6::date is null or (ts at time zone 'utc')::date <= $6)
        order by ts desc, id
        limit $7 offset $8
        "#,
        user_id,
        f.search,
        f.account_id,
        f.kind,
        f.from,
        f.to,
        f.limit,
        f.offset,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct PriceEligibleInstrument {
    pub id: Uuid,
    pub kind: String,
    pub symbol: Option<String>,
    pub isin: Option<String>,
    pub name: String,
    pub currency: String,
    pub meta: serde_json::Value,
}

/// Instruments worth a composition scrape: non-cash, holds a symbol/isin, not
/// already marked "none", and composition missing or older than 30 days.
pub async fn composition_eligible_instruments_for_connection(
    pool: &sqlx::PgPool,
    connection_id: Uuid,
) -> Result<Vec<PriceEligibleInstrument>, CoreError> {
    let rows = sqlx::query_as!(
        PriceEligibleInstrument,
        r#"
        select distinct
               i.id       as "id!",
               i.kind     as "kind!",
               i.symbol,
               i.isin,
               i.name     as "name!",
               i.currency as "currency!",
               i.meta     as "meta!"
        from holding h
        join account a    on a.id = h.account_id
        join instrument i on i.id = h.instrument_id
        where a.connection_id = $1
          and i.kind <> 'cash'
          and i.kind <> 'crypto'
          and h.quantity <> 0
          and (i.symbol is not null or i.isin is not null)
          and coalesce(i.meta->>'composition_status', '') <> 'none'
          and (
            i.meta->'composition'->>'as_of' is null
            or (i.meta->'composition'->>'as_of')::date < (now() - interval '30 days')::date
          )
        order by i.name
        "#,
        connection_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Distinct non-cash instruments held (nonzero quantity) under a connection,
/// plus the cash instrument (the FX rate) for every currency this connection
/// needs a rate for, excluding the pivot. Three sources, one per currency
/// domain, because a rate missing in any of them zeroes a figure:
///
/// * `instrument.currency` — a foreign security held in a base-currency account
///   (a USD equity in a EUR account) never holds USD *cash* itself, so reaching
///   rates only through `i.kind = 'cash'` rows would leave USD unfetchable.
/// * `price.currency` — the price domain. Powens may label an instrument EUR
///   while Yahoo resolves a London listing quoted GBP; `unit_value_asof` reads
///   the price row's currency, so without GBP here the holding stays NULL —
///   valued at zero — forever.
/// * `account.currency` — the amount domain. `holding.cost_basis` and
///   `holding_snapshot.value` convert from it, so a CHF account inside a EUR
///   install needs CHF even if every instrument in it is quoted in EUR.
///
/// Drives the per-connection price-fetch pass.
pub async fn price_eligible_instruments_for_connection(
    pool: &sqlx::PgPool,
    connection_id: Uuid,
) -> Result<Vec<PriceEligibleInstrument>, CoreError> {
    let rows = sqlx::query_as!(
        PriceEligibleInstrument,
        r#"
        select distinct
               i.id       as "id!",
               i.kind     as "kind!",
               i.symbol,
               i.isin,
               i.name     as "name!",
               i.currency as "currency!",
               i.meta     as "meta!"
        from holding h
        join account a    on a.id = h.account_id
        join instrument i on i.id = h.instrument_id
        where a.connection_id = $1
          and i.kind <> 'cash'
          and h.quantity <> 0

        union

        -- Foreign cash is eligible: its "price" is the FX rate. Cash in the
        -- pivot is 1 by definition and has no Yahoo pair. This reaches the cash
        -- instrument backing every currency this connection converts through,
        -- not just an actually-held foreign cash position (see the doc comment).
        select distinct
               fx.id       as "id!",
               fx.kind     as "kind!",
               fx.symbol,
               fx.isin,
               fx.name     as "name!",
               fx.currency as "currency!",
               fx.meta     as "meta!"
        from (
            select i.currency as cur
            from holding h
            join account a    on a.id = h.account_id
            join instrument i on i.id = h.instrument_id
            where a.connection_id = $1 and h.quantity <> 0

            union

            select p.currency
            from holding h
            join account a on a.id = h.account_id
            join price p   on p.instrument_id = h.instrument_id
            where a.connection_id = $1 and h.quantity <> 0

            union

            select a.currency
            from account a
            where a.connection_id = $1

            union

            -- The owner's reporting preference, which is a divisor and nothing
            -- else — no holding, price or account carries it, so it would never
            -- otherwise become rate-eligible and reporting_fx_asof would fall
            -- back to the pivot forever. Its cash instrument is created by
            -- ensure_cash_instruments_for_held_currencies, which unions the
            -- same arm.
            select u.prefs->>'currency'
            from connection c
            join users u on u.id = c.user_id
            where c.id = $1
        ) needed
        join instrument fx on fx.kind = 'cash' and fx.currency = needed.cur
        where needed.cur <> (select base_currency from app_settings where id = 1)
          and needed.cur ~ '^[A-Z]{3}$'

        order by 5
        "#,
        connection_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
