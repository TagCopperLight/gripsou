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
    /// Something this day was left out for want of a rate, up to the whole day.
    pub fx_missing: bool,
}

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

    // Rows come ordered by day, so each day's accounts are consecutive.
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

struct AccountDayRow {
    account_id: Uuid,
    name: String,
    color: String,
    as_of: NaiveDate,
    value: Option<Decimal>,
    invested: Option<Decimal>,
    fx_missing: bool,
}

/// `days` is not every day in the range: [`chart_days`] clamps and samples it first.
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
    pub instrument_isin: Option<String>,
    /// The identity column, not the display `symbol`.
    pub instrument_symbol: Option<String>,
    /// The currency the security is quoted in, not the currency of any amount on this row.
    pub currency: String,
    /// Currency of the price row `price` came from. May differ from `currency` (Powens labels an
    /// instrument EUR, Yahoo resolves a London listing quoted GBP). NULL with no price row.
    pub price_currency: Option<String>,
    /// The account's currency: `cost_basis`, `invested_native`, snapshot values and transaction
    /// amounts are all in it.
    pub account_currency: String,
    pub account_id: Uuid,
    pub account_name: String,
    pub account_color: String,
    pub type_key: String,
    pub quantity: Decimal,
    /// In `price_currency`, not `currency`.
    pub price: Option<Decimal>,
    pub spark: Vec<Decimal>,
    pub composition: Option<crate::dto::Composition>,
    /// Zero when a rate is unknown (see `fx_missing`).
    pub value: Decimal,
    /// Zero when a rate is unknown (see `fx_missing`).
    pub invested: Decimal,
    /// Label it with `account_currency`, never with `currency` or `price_currency`.
    pub invested_native: Decimal,
    /// `value` or `invested` reads zero for want of a rate.
    pub fx_missing: bool,
    /// Signed: positive means shares no lot explains, negative means more is recorded than held
    /// (an unrecorded sale). Non-zero means the cost basis and pre-purchase history are guesses,
    /// which the Holdings badge says. Always zero for cash.
    pub unexplained_quantity: Decimal,
    /// With no buy recorded, the basis over the quantity, so a real position doesn't read as zero.
    pub mean_price: Decimal,
}

impl HoldingRow {
    /// `instrument.kind` is never rewritten (it is half the natural key the next sync
    /// re-resolves the row by). Powens reports every security as `equity`, so a tracker is
    /// recognised by its scraped composition.
    pub fn display_kind(&self) -> &str {
        display_kind(&self.kind, self.composition.is_some())
    }

    /// A cash `price` row holds an exchange rate, not a unit price.
    fn is_cash(&self) -> bool {
        self.kind == "cash"
    }

    pub fn unit_price(&self) -> Decimal {
        if self.is_cash() {
            Decimal::ONE
        } else {
            self.price.unwrap_or(Decimal::ZERO)
        }
    }

    /// Differs from the instrument's when Yahoo resolves a listing quoted elsewhere.
    pub fn unit_price_currency(&self) -> &str {
        match &self.price_currency {
            Some(c) if !self.is_cash() => c,
            _ => &self.currency,
        }
    }

    pub fn value_native(&self) -> Option<Decimal> {
        (self.is_cash() || self.price.is_some()).then(|| self.quantity * self.unit_price())
    }

    pub fn spark(&self) -> Option<&[Decimal]> {
        (!self.is_cash() && !self.spark.is_empty()).then_some(self.spark.as_slice())
    }
}

fn display_kind(kind: &str, has_composition: bool) -> &str {
    match (kind, has_composition) {
        ("equity", true) => "etf",
        _ => kind,
    }
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
        -- Restates `holding_day_values`' inputs for today alone, for speed: a change to what
        -- feeds `holding_valuation` is made in both. The snapshot lateral is LEFT so a holding
        -- ingested before its first snapshot still lists.
        --
        -- Today is `user_today($1)` in each call, never a sub-select: Postgres doesn't inline a
        -- SQL function given one, and the opaque cost estimate turns on JIT (about a second).
        with grid as materialized (
            select * from valuation_grid($1, array[user_today($1)])
        ),
        fx as materialized (select currency, unit_value from grid where kind = 'cash'),
        rep as materialized (
            select unit_value from fx
            where currency = (select currency from users where id = $1)
        )
        select h.id            as "holding_id!",
               -- Display ticker, not the identity column: `symbol` is null on the ISIN path, so
               -- the resolved Yahoo ticker in meta is shown. Cash is excluded (its meta holds an FX
               -- pair like `CNYEUR=X`).
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
               -- Scoped to this holding's (account, instrument) via the `lot` lateral, or another
               -- user's buy of the same ETF would reduce it. SIGNED on purpose: flooring at zero
               -- would hide an over-recorded state the user must open the modal to fix.
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
        // Cash rows show no sparkline (their prices are FX rates), so skip the query.
        // The last 30 days, not 30 rows: a row count covers a different window when the feed's
        // cadence changes. An intraday feed would need a sample-down (repo::series).
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
    pub unit_price: Decimal,
    /// In the holding's account currency, the one lots are recorded in. Null when either rate is
    /// unknown.
    pub account_price: Option<Decimal>,
    /// In the reader's currency. Null when either rate is unknown.
    pub reporting_price: Option<Decimal>,
    pub qty: Option<Decimal>,
    pub invested: Option<Decimal>,
    pub reporting_invested: Option<Decimal>,
}

pub async fn holding_prices(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    holding_id: Uuid,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<PricePointRow>, CoreError> {
    super::holding::owned_holding(pool, user_id, holding_id).await?;
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
            where h.id = $1 and p.ts between $2 and $3
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
        -- A holding with no lot at all (a balances-only provider) is held flat at its quantity.
        left join lateral (
            select case when lots.first_day is null then lots.held
                        else b.explained_qty end as qty,
                   b.basis as invested
            where lots.first_day is null or pts.day >= lots.first_day
        ) pos on true
        order by pts.ts
        "#,
        holding_id,
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

pub async fn accounts(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<AccountRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountRow,
        r#"
        select a.id    as "account_id!",
               c.id    as "connection_id!",
               a.name  as "name!",
               a.color,
               a.type_key as "type_key!",
               coalesce(v.value, 0) as "value!",
               a.currency as "currency!",
               v.value_native as "value_native?",
               coalesce(v.fx_missing, false) as "fx_missing!",
               c.last_sync_at,
               c.institution_key,
               c.institution_name,
               c.provider_key
        from account_values_today($1) v
        join account a    on a.id = v.account_id
        join connection c on c.id = a.connection_id
        order by v.value_pivot desc
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

#[cfg(test)]
mod tests {
    #[test]
    fn display_kind_promotes_only_an_equity_with_a_composition() {
        use super::display_kind;
        assert_eq!(display_kind("equity", true), "etf");
        assert_eq!(display_kind("equity", false), "equity");
        assert_eq!(display_kind("cash", true), "cash");
        assert_eq!(display_kind("etf", false), "etf");
    }
}
