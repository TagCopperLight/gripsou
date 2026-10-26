//! Read-side aggregations for the dashboard, all scoped by user_id
//! (joined via connection.user_id). Money stays Decimal end-to-end.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;

#[derive(serde::Serialize)]
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

    // Net worth is the sum of the account values: rows come ordered by day,
    // so each day's accounts are consecutive.
    let mut rows: Vec<NetWorthRow> = Vec::new();
    for r in account_day_values(pool, user_id, &days).await? {
        match rows.last_mut() {
            Some(day) if day.as_of == r.as_of => {
                day.net_worth += r.value;
                day.invested += r.invested;
                day.fx_missing |= r.fx_missing;
            }
            _ => rows.push(NetWorthRow {
                as_of: r.as_of,
                net_worth: r.value,
                invested: r.invested,
                fx_missing: r.fx_missing,
                reporting_fx_missing: r.reporting_fx_missing,
            }),
        }
    }
    Ok(rows)
}

/// One account on one day, valued for both the net-worth line and the
/// stacked accounts chart.
struct AccountDayRow {
    account_id: Uuid,
    name: String,
    color: String,
    as_of: NaiveDate,
    value: Decimal,
    invested: Decimal,
    fx_missing: bool,
    reporting_fx_missing: bool,
}

/// The one per-day valuation, grouped by (day, account), ordered by day.
async fn account_day_values(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    days: &[NaiveDate],
) -> Result<Vec<AccountDayRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountDayRow,
        r#"
        -- Per day, value each holding from its as-of snapshot (quantity anchor)
        -- and valuation_grid's unit_value, which folds in the FX rate. The INNER JOIN LATERAL
        -- excludes a holding on days before its first snapshot (no row) — so a
        -- position never contributes before it was acquired. A sold holding keeps
        -- its history (its zero snapshot values it at 0 thereafter). Falling back
        -- to the provider valuation (snap.value) still needs converting, hence
        -- the account-currency rate (afx) on that branch. Each account is summed in
        -- the pivot, then divided into the reader's reporting currency.
        --
        -- Three currency domains, never conflated:
        --   price     — the `price` row's own currency, folded in by
        --               valuation_grid (it reads the price row, not the
        --               instrument);
        --   amount    — `account.currency`, which is what the provider denominates
        --               snapshot.value in, hence the afx join on that branch;
        --   reporting — `users.currency`, applied by the final divide.
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
        with dates as materialized (
            select as_of, reporting_fx_degraded($1, as_of) as reporting_fx_missing
            from (select distinct unnest($2::date[]) as as_of) d
        ),
        -- One valuation per instrument-day instead of one per holding-day, with
        -- the FX lookup folded into the same scan. `materialized` is load-bearing
        -- on all three: an inlined CTE here gets re-executed per outer row.
        grid as materialized (select * from valuation_grid($1, $2)),
        fx   as materialized (select as_of, currency, unit_value from grid where kind = 'cash'),
        rep  as materialized (
            select as_of, unit_value from fx
            where currency = (select currency from users where id = $1)
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
        select a.id    as "account_id!",
               a.name  as "name!",
               a.color as "color",
               d.as_of as "as_of!",
               coalesce(sum(coalesce(
                   snap.quantity * uv.unit_value,
                   snap.value * afx.unit_value,
                   0
               )), 0) / coalesce(nullif(rep.unit_value, 0), 1) as "value!",
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
               d.reporting_fx_missing as "reporting_fx_missing!"
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
        -- (enforced by stamp_snapshot) is that no day carries both, so the
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
        group by d.as_of, d.reporting_fx_missing, a.id, a.name, a.color, rep.unit_value
        order by d.as_of, a.id
        "#,
        user_id,
        days,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(serde::Serialize)]
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
    pub account_color: String,
    /// Stable account-type key (`checking`, `pea`, …); the frontend translates it.
    pub type_key: String,
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
    /// Shares no recorded lot explains: `quantity − Σ buys + Σ sells`.
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
        isin: Option<String>,
        raw_symbol: Option<String>,
        currency: String,
        price_currency: Option<String>,
        account_currency: String,
        instrument_id: Uuid,
        account_id: Uuid,
        account_name: String,
        account_color: String,
        type_key: String,
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
        -- Same valuation rule as net_worth_series/accounts: price
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
        with today as (select user_today($1) as d)
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
               i.isin,
               i.symbol        as "raw_symbol",
               i.meta->'composition' as "composition?",
               i.currency      as "currency!",
               px.currency     as "price_currency?",
               a.currency      as "account_currency!",
               i.id            as "instrument_id!",
               a.id            as "account_id!",
               a.name          as "account_name!",
               a.color         as "account_color",
               a.type_key      as "type_key!",
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
               -- has no rate, so `invested` above coalesced to zero. Unflagged,
               -- the second would show a real value against a zero cost basis
               -- and an invented gain.
               ((unit_value_asof(i.id, (select d from today)) is null
                 and coalesce(snap.value * fx_asof(a.currency, (select d from today)), 0) = 0)
                or (coalesce(lot.basis, 0) <> 0
                    and fx_asof(a.currency, (select d from today)) is null))
                   as "fx_missing!",
               -- Shares no recorded lot explains. Scoped to THIS holding's
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
        left join lateral (
            select p.unit_price, p.currency
            from price p
            where p.instrument_id = i.id
              and p.ts < (((select d from today) + 1)::timestamp at time zone 'UTC')
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
            -- THE basis rule, called not reimplemented. The rule once written
            -- inline here now lives in lot_basis (0022), so the holdings table,
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
            logo_url: crate::logo::instrument_logo_url(
                &b.kind,
                b.isin.as_deref(),
                b.raw_symbol.as_deref(),
            ),
            kind: b.kind,
            currency: b.currency,
            price_currency: b.price_currency,
            account_currency: b.account_currency,
            account_id: b.account_id,
            account_name: b.account_name,
            account_color: b.account_color,
            type_key: b.type_key,
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

#[derive(serde::Serialize)]
pub struct PricePointRow {
    pub ts: DateTime<Utc>,
    /// In the price row's own currency (the listing's quote).
    pub unit_price: Decimal,
    /// The same price in the holding's account currency, at that day's rates:
    /// the domain lots are recorded in, so it can sit next to them. Null when
    /// either rate is unknown.
    pub account_price: Option<Decimal>,
    /// The same price in the reader's currency at that day's rates. Null when
    /// either rate is unknown.
    pub reporting_price: Option<Decimal>,
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
        with pts as materialized (
            select p.ts, p.unit_price, p.currency as quote, a.currency as acct,
                   (p.ts at time zone 'utc')::date as day
            from price p
            join holding h    on h.instrument_id = p.instrument_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
            where h.id = $1 and c.user_id = $2 and p.ts between $3 and $4
        ),
        asked as (
            select quote as currency, day from pts
            union
            select acct, day from pts
            union
            select (select currency from users where id = $2), day from pts
        ),
        -- fx_asof for every asked (currency, day) in one ordered pass: each
        -- asked day sorts after that day's rates, so it falls in the run of
        -- the last rate stamped on or before it. Calling fx_asof twice per
        -- price instead costs a few times longer on a long history.
        runs as (
            select currency, asked, rate, day,
                   count(rate) over (partition by currency order by day, asked, ts) as run
            from (
                select i.currency, (r.ts at time zone 'utc')::date as day,
                       r.unit_price as rate, r.ts, false as asked
                from instrument i
                join price r on r.instrument_id = i.id
                where i.kind = 'cash' and i.currency in (select currency from asked)
                union all
                select currency, day, null, null, true from asked
            ) t
        ),
        rates as materialized (
            select currency, day,
                   case when currency = (select base_currency from app_settings where id = 1)
                        then 1::numeric
                        else rate
                   end as rate
            from (
                select currency, day, asked,
                       max(rate) over (partition by currency, run) as rate
                from runs
            ) f
            where asked
        )
        select pts.ts as "ts!", pts.unit_price as "unit_price!",
               pts.unit_price * q.rate / nullif(ac.rate, 0) as "account_price?",
               pts.unit_price * q.rate / nullif(rp.rate, 0) as "reporting_price?"
        from pts
        join rates q  on q.currency = pts.quote and q.day = pts.day
        join rates ac on ac.currency = pts.acct and ac.day = pts.day
        join rates rp on rp.currency = (select currency from users where id = $2) and rp.day = pts.day
        order by pts.ts
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

#[derive(serde::Serialize)]
pub struct AccountRow {
    pub account_id: Uuid,
    pub connection_id: Uuid,
    pub name: String,
    pub color: String,
    pub type_key: String,
    pub value: Decimal,
    pub fx_missing: bool,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub institution_key: Option<String>,
    pub institution_name: Option<String>,
    pub provider_key: String,
}

/// One row per account: latest snapshot value per holding, summed, with its
/// connection and the connection's last sync time.
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
        -- Valued through `valuation_grid`, not the scalar
        -- unit_value_asof/fx_asof/reporting_fx_asof functions: in the select
        -- list of a `distinct on` they would price every historical snapshot
        -- row (Postgres projects before it uniquifies) and then discard all but
        -- the newest, a cost that grows every day. Joined, the grid makes the
        -- per-row work a hash probe.
        --
        -- The grid joins are LEFT on purpose: a missing row must leave
        -- unit_value NULL so the coalesce falls through to the provider
        -- valuation, exactly as a NULL from unit_value_asof did. `rep`
        -- reproduces reporting_fx_asof's own coalesce(nullif(rate, 0), 1) —
        -- no usable rate means report in the pivot rather than 500 on a
        -- division by zero.
        with today as (select user_today($1) as d),
        grid as materialized (
            select * from valuation_grid($1, array[(select d from today)]::date[])
        ),
        fx  as materialized (select currency, unit_value from grid where kind = 'cash'),
        rep as materialized (
            select unit_value from fx
            where currency = (select currency from users where id = $1)
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
               c.id    as "connection_id!",
               a.name  as "name!",
               a.color,
               a.type_key as "type_key!",
               sum(l.value) / coalesce(nullif((select unit_value from rep), 0), 1) as "value!",
               coalesce(bool_or(l.fx_missing), false) as "fx_missing!",
               c.last_sync_at,
               c.institution_key,
               c.institution_name,
               c.provider_key
        from latest l
        join holding h      on h.id = l.holding_id
        join account a      on a.id = h.account_id
        join connection c   on c.id = a.connection_id
        group by a.id, c.id, a.name, a.color, a.type_key, c.last_sync_at, c.institution_key, c.institution_name, c.provider_key
        order by sum(l.value) desc
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(serde::Serialize)]
pub struct AccountSeriesRow {
    pub account_id: Uuid,
    pub name: String,
    pub color: String,
    pub as_of: NaiveDate,
    pub value: Decimal,
}

/// Stacked-area source: each account's value per day over a window, from the
/// same valuation as [`net_worth_series`].
pub async fn account_series(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<AccountSeriesRow>, CoreError> {
    let start = crate::repo::series::history_start(pool, user_id)
        .await?
        .map_or(from, |h| h.max(from));
    let days =
        crate::repo::series::sample_days(start, to, crate::repo::series::CHART_TARGET_POINTS);

    let rows = account_day_values(pool, user_id, &days)
        .await?
        .into_iter()
        .map(|r| AccountSeriesRow {
            account_id: r.account_id,
            name: r.name,
            color: r.color,
            as_of: r.as_of,
            value: r.value,
        })
        .collect();
    Ok(rows)
}

/// Every account-type key. New types are data inserts here — no code change
/// needed to offer them in the edit-account dropdown.
pub async fn account_types(pool: &sqlx::PgPool) -> Result<Vec<String>, CoreError> {
    let keys = sqlx::query_scalar!("select key from account_type order by key")
        .fetch_all(pool)
        .await?;
    Ok(keys)
}

#[derive(serde::Serialize)]
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

#[derive(serde::Serialize)]
pub struct TransactionListRow {
    pub id: Uuid,
    pub day: NaiveDate,
    pub kind: String,
    pub description: Option<String>,
    /// In `account_currency` — the amount domain, as the provider sent it. Not
    /// converted: the list shows what actually moved in the account.
    pub amount: Decimal,
    /// The same movement in the reader's currency at the transaction's own
    /// date. The list renders `amount`; this exists so an explicit multi-row
    /// selection can be totalled without a round trip.
    /// `None` when the account's or the reader's currency has no rate that day.
    pub amount_reporting: Option<Decimal>,
    /// `"cash"` for a `transaction` row, `"lot"` for a purchase/sale that now
    /// lives in the `lot` table. Structured, not a pre-built sentence: the
    /// frontend's i18n and per-user number formatting render the lot fields.
    pub source: String,
    pub ticker: Option<String>,
    /// What a lot row's logo is built from (`logo::instrument_logo_url`);
    /// null on a cash row.
    pub instrument_kind: Option<String>,
    pub instrument_isin: Option<String>,
    pub instrument_symbol: Option<String>,
    pub quantity: Option<Decimal>,
    pub unit_price: Option<Decimal>,
    pub fee: Option<Decimal>,
    pub account_id: Uuid,
    pub account_name: String,
    pub account_color: String,
    /// Also the currency of a lot row's `amount`: lot prices are recorded in
    /// the account's currency, as `lot_basis` and the holdings table assume.
    pub account_currency: String,

    // ── Budget ──────────────────────────────────────────────────────────────
    // All null/false on a lot row: a purchase is an investment record, not a
    // budget item.
    pub category_id: Option<Uuid>,
    pub category_name: Option<String>,
    pub category_default_key: Option<String>,
    pub category_color: Option<String>,
    pub category_icon: Option<String>,
    pub category_kind: Option<String>,
    pub category_source: Option<String>,
    pub category_confidence: Option<Decimal>,
    /// Derived, never stored: an unreviewed AI guess that is under the reader's threshold, has no category, or sits in an internal/excluded category.
    pub needs_review: bool,
    pub checked: bool,
    /// The row is one half of an auto-paired internal transfer.
    pub is_transfer: bool,
    /// The pairing pass categorised this row, but its link is gone — a user
    /// corrected the other half, so this one still reads as an
    /// internal transfer while netting against nothing.
    ///
    /// Keyed on `category_source = 'pair'` rather than on the category itself:
    /// only the pairing pass writes that source, and it always writes a link,
    /// so a missing link means one was removed. A cross-currency transfer the
    /// user categorised by hand never had a link (pairing matches
    /// one currency only) and must not be
    /// flagged forever.
    pub is_orphan_transfer: bool,
}

/// The TYPE control on the filter panel: one value, always one selected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub enum TypeBucket {
    #[default]
    All,
    MoneyIn,
    MoneyOut,
    Lots,
}

impl TypeBucket {
    /// Wire form, as the API query parameter spells it. `None` for anything
    /// else: an unknown bucket must never widen to `all`.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "all" => Some(Self::All),
            "in" => Some(Self::MoneyIn),
            "out" => Some(Self::MoneyOut),
            "lots" => Some(Self::Lots),
            _ => None,
        }
    }

    fn as_sql(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::MoneyIn => "in",
            Self::MoneyOut => "out",
            Self::Lots => "lots",
        }
    }
}

/// The review threshold used when a caller has no reader preference to hand.
/// Kept equal to the preference's own default.
pub fn default_review_threshold() -> Decimal {
    Decimal::new(crate::repo::prefs::DEFAULT_BUDGET_AI_THRESHOLD as i64, 2)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TransactionFilters {
    /// Case-insensitive substring of `description` (cash rows) or `ticker`
    /// (lot rows).
    pub search: Option<String>,
    pub account_id: Option<Uuid>,
    pub bucket: TypeBucket,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    /// Empty means no filter. Several categories mean *either* of them.
    pub category_ids: Vec<Uuid>,
    /// Empty means no filter. Several tags mean *all* of them.
    pub tag_ids: Vec<Uuid>,
    pub uncategorized: bool,
    pub needs_review: bool,
    /// Internal transfers (the `internal_transfer` system category) are hidden
    /// unless this is set: they are money moving between the user's own
    /// accounts, noise in a list about spending. The OTHERS panel's
    /// "Internal transfers" toggle is the only thing that turns them back on,
    /// and when it does they are filtered like any other row.
    pub include_transfers: bool,
    /// Below this, an AI guess is in the review queue. A parameter rather than
    /// a constant so moving it reshapes the queue instantly.
    pub review_threshold: Decimal,
    pub limit: i64,
    pub offset: i64,
}

/// Everything, unfiltered — the base a caller mutates.
impl Default for TransactionFilters {
    fn default() -> Self {
        Self {
            search: None,
            account_id: None,
            bucket: TypeBucket::All,
            from: None,
            to: None,
            category_ids: vec![],
            tag_ids: vec![],
            uncategorized: false,
            needs_review: false,
            include_transfers: true,
            review_threshold: default_review_threshold(),
            limit: 200,
            offset: 0,
        }
    }
}

/// The Transactions page. The rows and the filter are the
/// `budget_transaction_matches` SQL function (migration 0028), which the
/// header counts and the bulk target read too, so the three cannot disagree
/// about which rows a filter admits. Every filter is optional inside it, so
/// one prepared statement covers all combinations and the macro still checks
/// this query at compile time.
pub async fn transactions(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    f: &TransactionFilters,
) -> Result<Vec<TransactionListRow>, CoreError> {
    let rows = sqlx::query_as!(
        TransactionListRow,
        r#"
        -- The filter/sort/page cut happens BEFORE any valuation, so the grid
        -- below prices only the days this page actually needs, not the user's
        -- entire history.
        with filtered as (
            select *
            from budget_transaction_matches($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            order by day desc, id
            limit $13 offset $14
        ),
        days as (select distinct day from filtered),
        grid as materialized (
            select as_of, currency, unit_value
            from valuation_grid($1, array(select day from days)::date[])
            where kind = 'cash'
        ),
        reporting as (
            select (select currency from users where id = $1) as code
        )
        select id as "id!", day as "day!", kind as "kind!", description, amount as "amount!",
               -- Null, not zero or a pivot figure, when either rate is
               -- missing: the list then shows no converted value at all.
               filtered.amount * afx.unit_value / nullif(rfx.unit_value, 0)
                   as "amount_reporting?",
               source as "source!", ticker, instrument_kind, instrument_isin,
               instrument_symbol, quantity, unit_price, fee,
               account_id as "account_id!", account_name as "account_name!",
               account_color as "account_color!", account_currency as "account_currency!",
               filtered.category_id, category_name, category_default_key, category_color,
               category_icon, category_kind, category_source, category_confidence,
               needs_review as "needs_review!", checked as "checked!",
               is_transfer as "is_transfer!",
               is_orphan_transfer as "is_orphan_transfer!"
        from filtered
        left join grid afx on afx.as_of = filtered.day
                          and afx.currency = filtered.account_currency
        left join grid rfx on rfx.as_of = filtered.day
                          and rfx.currency = (select code from reporting)
        order by day desc, id
        "#,
        user_id,
        f.review_threshold,
        f.search,
        f.account_id,
        f.from,
        f.to,
        f.bucket.as_sql(),
        &f.category_ids,
        &f.tag_ids,
        f.uncategorized,
        f.needs_review,
        f.include_transfers,
        f.limit,
        f.offset,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TagRef {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
}

/// Tags for a page of transactions, in one round trip. Untagged rows are absent
/// from the map rather than present with an empty vector.
///
/// Ordered exactly like the catalog `list_tags` returns (oldest tag first),
/// not by name: the row and the tag chooser then read in the same order, and
/// assigning a tag no longer makes an existing one jump. Where a row's tags
/// overflow its cell the frontend drops the tail, so "oldest first" also
/// decides which ones survive.
pub async fn tags_for_transactions(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    ids: &[Uuid],
) -> Result<std::collections::HashMap<Uuid, Vec<TagRef>>, CoreError> {
    let rows = sqlx::query!(
        r#"
        select tt.transaction_id as "transaction_id!",
               g.id   as "id!",
               g.name as "name!",
               g.color
        from budget_transaction_tag tt
        join budget_tag g on g.id = tt.tag_id
        join transaction t on t.id = tt.transaction_id
        join account a     on a.id = t.account_id
        join connection k  on k.id = a.connection_id
        where tt.transaction_id = any($1)
          and k.user_id = $2
        order by g.created_at, g.name, g.id
        "#,
        ids,
        user_id,
    )
    .fetch_all(pool)
    .await?;

    let mut map: std::collections::HashMap<Uuid, Vec<TagRef>> = std::collections::HashMap::new();
    for r in rows {
        map.entry(r.transaction_id).or_default().push(TagRef {
            id: r.id,
            name: r.name,
            color: r.color,
        });
    }
    Ok(map)
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct TransactionCounts {
    /// Rows under the active filters — the left half of "matching / total".
    pub matching: i64,
    /// Every cash and lot row this user has, filters ignored.
    pub total: i64,
    /// Cash rows with no category, filters ignored — the list header's second
    /// number, and the one that starts out enormous.
    pub uncategorized: i64,
    /// The selection bar's figure: `matching`'s rows summed in the reader's
    /// reporting currency, each converted at its own date.
    pub matching_total: Decimal,
    /// At least one matching row's ACCOUNT leg had no rate on its day, so
    /// `matching_total` is understated by whatever that row was worth.
    /// Mirrors `SummaryDto.fxMissing` — same convention, same meaning.
    pub fx_missing: bool,
    /// The reader's reporting currency had no rate on at least one matching
    /// row's day, so that row's contribution to `matching_total` is in the
    /// pivot currency, not the reporting one — nothing is missing from the
    /// sum, but part of it may be in a different currency than the rest.
    /// Mirrors `SummaryDto.reportingFxMissing`.
    pub reporting_fx_missing: bool,
}

/// The list header. `matching` reads the same `budget_transaction_matches` as
/// `transactions()`, so it counts exactly the rows the list pages through —
/// under `bucket: All` that includes lot rows, unlike
/// `matching_transaction_ids`, which keeps only the cash ones.
pub async fn transaction_counts(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    f: &TransactionFilters,
) -> Result<TransactionCounts, CoreError> {
    let row = sqlx::query!(
        r#"
        with matching as (
            select amount, account_currency, day
            from budget_transaction_matches($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ),
        reporting as (
            select (select currency from users where id = $1) as code
        ),
        -- One FX row per needed day and account currency, with both legs.
        -- Keeping reporting FX on the same row avoids a separate join whose
        -- generic plan estimates one reporting row and repeatedly scans the
        -- entire date grid for every matching transaction. Scalar FX reads
        -- also avoid pricing held securities that this cash total never uses.
        fx as materialized (
            select day, account_currency,
                   fx_asof(account_currency, day) as account_rate,
                   fx_asof((select code from reporting), day) as reporting_rate
            from (select distinct day, account_currency from matching) needed
        ),
        totals as (
            select count(*) as n,
                   coalesce(sum(m.amount * fx.account_rate
                                / coalesce(nullif(fx.reporting_rate, 0), 1)), 0) as total,
                   -- Keyed on the account leg only: a missing reporting rate
                   -- degrades to the pivot rather than dropping anything from
                   -- the sum, so it must not set this.
                   coalesce(bool_or(fx.account_rate is null), false) as fx_missing,
                   -- Read off the same divisor the sum just used, so the flag
                   -- is set exactly when that divisor fell back to 1.
                   coalesce(bool_or(coalesce(fx.reporting_rate, 0) = 0), false)
                       as reporting_fx_missing
            from matching m
            left join fx on fx.day = m.day and fx.account_currency = m.account_currency
        ),
        everything as (
            select count(*) as n,
                   count(*) filter (where source = 'cash' and category_id is null)
                       as uncategorized
            from budget_transaction_rows($1, $2)
        )
        select t.n as "matching!", t.total as "matching_total!",
               t.fx_missing as "fx_missing!",
               t.reporting_fx_missing as "reporting_fx_missing!",
               e.n as "total!", e.uncategorized as "uncategorized!"
        from totals t, everything e
        "#,
        user_id,
        f.review_threshold,
        f.search,
        f.account_id,
        f.from,
        f.to,
        f.bucket.as_sql(),
        &f.category_ids,
        &f.tag_ids,
        f.uncategorized,
        f.needs_review,
        f.include_transfers,
    )
    .fetch_one(pool)
    .await?;

    Ok(TransactionCounts {
        matching: row.matching,
        total: row.total,
        uncategorized: row.uncategorized,
        matching_total: row.matching_total,
        fx_missing: row.fx_missing,
        reporting_fx_missing: row.reporting_fx_missing,
    })
}

/// Ids of the **cash** transactions matching the filters — what "select all
/// shown" means, and what every bulk action runs against. Same filter as the
/// list; lot rows are dropped because they carry no budget.
pub async fn matching_transaction_ids(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    f: &TransactionFilters,
) -> Result<Vec<Uuid>, CoreError> {
    let ids = sqlx::query_scalar!(
        r#"
        select id as "id!"
        from budget_transaction_matches($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        where source = 'cash'
        order by day desc, id
        "#,
        user_id,
        f.review_threshold,
        f.search,
        f.account_id,
        f.from,
        f.to,
        f.bucket.as_sql(),
        &f.category_ids,
        &f.tag_ids,
        f.uncategorized,
        f.needs_review,
        f.include_transfers,
    )
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

#[derive(serde::Serialize)]
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
/// needs a rate for, excluding the pivot (`connection_fx_currencies`, which
/// says why each one is needed).
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
        -- pivot is 1 by definition and has no Yahoo pair.
        select fx.id       as "id!",
               fx.kind     as "kind!",
               fx.symbol,
               fx.isin,
               fx.name     as "name!",
               fx.currency as "currency!",
               fx.meta     as "meta!"
        from connection_fx_currencies($1) cur
        join instrument fx on fx.kind = 'cash' and fx.currency = cur

        order by 5
        "#,
        connection_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
