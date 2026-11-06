//! What the dashboard reads: net worth and account history, holdings, a
//! holding's price history and today's accounts, all valued by the one SQL
//! surface (`holding_valuation`, `holding_day_values`, `fx_convert`) and
//! scoped by `connection.user_id`. Money stays Decimal end-to-end.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::error::CoreError;
use crate::repo::series;

pub struct NetWorthRow {
    pub as_of: NaiveDate,
    /// Null when the reader's currency has no rate that day.
    pub net_worth: Option<Decimal>,
    /// Null when the reader's currency has no rate that day.
    pub invested: Option<Decimal>,
    /// Something on this day was left out for want of a rate: a holding
    /// valued at zero, a basis missing from `invested`, or, when the reader's
    /// currency had no rate, the whole day.
    pub fx_missing: bool,
}

/// The days a chart over `from..=to` is computed on: clamped to the user's
/// real history, then sampled ([`series::sample_days`]).
async fn chart_days(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<NaiveDate>, CoreError> {
    let start = series::history_start(pool, user_id)
        .await?
        .map_or(from, |h| h.max(from));
    Ok(series::sample_days(start, to, series::CHART_TARGET_POINTS))
}

pub async fn net_worth_series(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<NetWorthRow>, CoreError> {
    let days = chart_days(pool, user_id, from, to).await?;

    // Net worth is the sum of the account values: rows come ordered by day,
    // so each day's accounts are consecutive.
    let mut rows: Vec<NetWorthRow> = Vec::new();
    for r in account_day_values(pool, user_id, &days).await? {
        match rows.last_mut() {
            Some(day) if day.as_of == r.as_of => {
                day.net_worth = day.net_worth.zip(r.value).map(|(a, b)| a + b);
                day.invested = day.invested.zip(r.invested).map(|(a, b)| a + b);
                day.fx_missing |= r.fx_missing;
            }
            _ => rows.push(NetWorthRow {
                as_of: r.as_of,
                net_worth: r.value,
                invested: r.invested,
                fx_missing: r.fx_missing,
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
    value: Option<Decimal>,
    invested: Option<Decimal>,
    fx_missing: bool,
}

/// The one per-day valuation (`holding_day_values`), grouped by (day,
/// account), ordered by day.
///
/// `days` is not every day in the range: [`chart_days`] clamps the axis to
/// real history and samples it down first.
async fn account_day_values(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    days: &[NaiveDate],
) -> Result<Vec<AccountDayRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountDayRow,
        r#"
        select a.id    as "account_id!",
               a.name  as "name!",
               a.color as "color",
               v.as_of as "as_of!",
               fx_convert(sum(v.value), 1, v.reporting_rate) as "value?",
               fx_convert(sum(v.invested), 1, v.reporting_rate) as "invested?",
               coalesce(bool_or(v.fx_missing), false) as "fx_missing!"
        from holding_day_values($1, $2) v
        join account a on a.id = v.account_id
        group by v.as_of, a.id, a.name, a.color, v.reporting_rate
        order by v.as_of, a.id
        "#,
        user_id,
        days,
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
    /// With `kind`, what the logo is built from (`Logos::instrument` in `providers`).
    pub instrument_isin: Option<String>,
    /// The identity column, not the display `symbol`.
    pub instrument_symbol: Option<String>,
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
    /// Position value in the reader's reporting currency. Zero when a rate is
    /// unknown (see `fx_missing`).
    pub value: Decimal,
    /// Cost basis in the reader's reporting currency. Zero when a rate is
    /// unknown (see `fx_missing`).
    pub invested: Decimal,
    /// Cost basis in the *account's* currency — the amount-domain figure, which
    /// is what the provider denominated it in. Label it with `account_currency`,
    /// never with `currency` or `price_currency`.
    pub invested_native: Decimal,
    /// `value` or `invested` reads zero for want of a rate
    /// (`holding_valuation`).
    pub fx_missing: bool,
    /// Shares no recorded lot explains: `quantity − Σ buys + Σ sells`.
    /// Signed: positive means shares no lot explains, negative means more is
    /// recorded than held (an unrecorded sale). Non-zero means the cost basis
    /// and the pre-purchase history are guesses, which the Holdings badge says
    /// out loud. Always zero for cash — a cash line has nothing to explain.
    pub unexplained_quantity: Decimal,
    /// Fee-inclusive mean buy price, amount domain (account currency). When
    /// no buy is recorded (a provider that reports a balance but no lots), the
    /// basis over the quantity, so a real position does not read as zero.
    pub mean_price: Decimal,
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
    }

    let bases = sqlx::query_as!(
        Base,
        r#"
        -- Valued by the same rule as every other reader (`holding_valuation`),
        -- from the holding's current quantity and its latest snapshot. The
        -- snapshot lateral is LEFT because a holding ingested before its first
        -- snapshot must still list (it just has no provider valuation).
        --
        -- Today is `user_today($1)` in each call, never a sub-select: Postgres
        -- does not inline a SQL function given a sub-select argument, and the
        -- opaque calls' cost estimate turns on JIT, which takes a second.
        with grid as materialized (
            select * from valuation_grid($1, array[user_today($1)])
        ),
        fx as materialized (select currency, unit_value from grid where kind = 'cash'),
        rep as materialized (
            select unit_value from fx
            where currency = (select currency from users where id = $1)
        )
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
               coalesce(fx_convert(v.value, 1, rep.unit_value), 0) as "value!",
               coalesce(fx_convert(v.invested, 1, rep.unit_value), 0) as "invested!",
               lot.basis      as "invested_native!",
               lot.mean_price as "mean_price!",
               v.fx_missing   as "fx_missing!",
               -- Shares no recorded lot explains. Scoped to THIS holding's
               -- (account, instrument) via the `lot` lateral — never the
               -- instrument alone, or another user's buy of the same ETF would
               -- reduce this figure.
               --
               -- SIGNED, deliberately: negative means more is recorded than is
               -- held. Flooring it at zero would hide that state, and the user
               -- could never open the modal to fix it.
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
              and p.ts < ((user_today($1) + 1)::timestamp at time zone 'UTC')
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
            select case when coalesce(b.mean_price, 0) = 0
                        then coalesce(b.basis / nullif(h.quantity, 0), 0)
                        else b.mean_price end as mean_price,
                   b.explained_qty,
                   b.basis
            from lot_basis(array[h.id], array[user_today($1)]) b
        ) lot on true
        left join grid uv on uv.instrument_id = i.id
        left join fx afx  on afx.currency = a.currency
        left join rep     on true
        cross join lateral holding_valuation(
            h.quantity, uv.unit_value, snap.value, lot.basis, afx.unit_value, rep.unit_value
        ) v
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
            instrument_isin: b.isin,
            instrument_symbol: b.raw_symbol,
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
        });
    }
    Ok(out)
}

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
    /// Shares held that day as the lots explain them. Null before the first lot.
    pub qty: Option<Decimal>,
    /// Cost basis that day (`lot_basis`), in the account's currency. Null
    /// before the first lot.
    pub invested: Option<Decimal>,
    /// `invested` in the reader's currency. Null when either rate is unknown.
    pub reporting_invested: Option<Decimal>,
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
                   u.currency as rep, (p.ts at time zone 'utc')::date as day
            from price p
            join holding h    on h.instrument_id = p.instrument_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
            join users u      on u.id = c.user_id
            where h.id = $1 and c.user_id = $2 and p.ts between $3 and $4
        ),
        rates as materialized (
            select as_of, currency, rate
            from fx_grid(
                array(select distinct day from pts),
                array(select quote from pts
                      union select acct from pts
                      union select rep from pts)
            )
        ),
        lots as (
            select h.quantity as held,
                   (select min(l.acquired_on) from lot l where l.holding_id = h.id) as first_day
            from holding h
            where h.id = $1
        ),
        basis as materialized (
            select as_of, explained_qty, basis
            from lot_basis(array[$1]::uuid[], array(select distinct day from pts))
        )
        select pts.ts as "ts!", pts.unit_price as "unit_price!",
               fx_convert(pts.unit_price, q.rate, ac.rate) as "account_price?",
               fx_convert(pts.unit_price, q.rate, rp.rate) as "reporting_price?",
               pos.qty as "qty?",
               pos.invested as "invested?",
               fx_convert(pos.invested, ac.rate, rp.rate) as "reporting_invested?"
        from pts
        left join rates q  on q.currency = pts.quote and q.as_of = pts.day
        left join rates ac on ac.currency = pts.acct and ac.as_of = pts.day
        left join rates rp on rp.currency = pts.rep and rp.as_of = pts.day
        cross join lots
        left join basis b on b.as_of = pts.day
        -- No position before the first lot. A holding with no lot at all (a
        -- provider that reports balances only) is held flat at its quantity.
        left join lateral (
            select case when lots.first_day is null then lots.held
                        else b.explained_qty end as qty,
                   b.basis as invested
            where lots.first_day is null or pts.day >= lots.first_day
        ) pos on true
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

pub struct AccountRow {
    pub account_id: Uuid,
    pub connection_id: Uuid,
    pub name: String,
    pub color: String,
    pub type_key: String,
    pub value: Decimal,
    pub currency: String,
    pub value_native: Option<Decimal>,
    pub fx_missing: bool,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub institution_key: Option<String>,
    pub institution_name: Option<String>,
    pub provider_key: String,
}

/// One row per account valued today, by the same `holding_day_values` as the
/// net-worth chart, so the accounts grid sums to the chart's last point.
pub async fn accounts(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<AccountRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountRow,
        r#"
        with v as (
            select v.account_id,
                   sum(v.value) as value,
                   v.account_rate,
                   v.reporting_rate,
                   bool_or(v.fx_missing) as fx_missing
            from holding_day_values($1, array[user_today($1)]) v
            group by v.account_id, v.account_rate, v.reporting_rate
        )
        select a.id    as "account_id!",
               c.id    as "connection_id!",
               a.name  as "name!",
               a.color,
               a.type_key as "type_key!",
               coalesce(fx_convert(v.value, 1, v.reporting_rate), 0) as "value!",
               a.currency as "currency!",
               -- The same sum in the account's own currency.
               fx_convert(v.value, 1, v.account_rate) as "value_native?",
               coalesce(v.fx_missing, false) as "fx_missing!",
               c.last_sync_at,
               c.institution_key,
               c.institution_name,
               c.provider_key
        from v
        join account a    on a.id = v.account_id
        join connection c on c.id = a.connection_id
        order by v.value desc
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
    pub color: String,
    pub as_of: NaiveDate,
    /// Null when the reader's currency has no rate that day.
    pub value: Option<Decimal>,
}

/// Stacked-area source: each account's value per day over a window, from the
/// same valuation as [`net_worth_series`].
pub async fn account_series(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<AccountSeriesRow>, CoreError> {
    let days = chart_days(pool, user_id, from, to).await?;

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
