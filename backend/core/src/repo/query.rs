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
}

pub async fn net_worth_series(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<NetWorthRow>, CoreError> {
    let rows = sqlx::query_as!(
        NetWorthRow,
        r#"
        -- Per day, value each holding from its as-of snapshot (quantity anchor)
        -- and the price series. The INNER JOIN LATERAL excludes a holding on days
        -- before its first snapshot (no row) — so a position never contributes
        -- before it was acquired — and fetches quantity/value/cost_basis in one
        -- lookup. A sold holding keeps its history (its zero snapshot values it at
        -- 0 thereafter). Value = qty * price-as-of, falling back to the provider
        -- valuation (snap.value) when no price exists yet.
        with dates as (
            select generate_series($2::date, $3::date, '1 day'::interval)::date as as_of
        )
        select d.as_of as "as_of!",
               coalesce(sum(
                   case
                       when i.kind = 'cash' then snap.quantity
                       else coalesce(snap.quantity * price_asof(i.id, d.as_of), snap.value, 0)
                   end
               ), 0) as "net_worth!",
               coalesce(sum(snap.cost_basis), 0) as "invested!"
        from dates d
        cross join holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        join instrument i on i.id = h.instrument_id
        join lateral (
            select hs.quantity, hs.value, hs.cost_basis
            from holding_snapshot hs
            where hs.holding_id = h.id and hs.as_of <= d.as_of
            order by hs.as_of desc
            limit 1
        ) snap on true
        where c.user_id = $1
        group by d.as_of
        order by d.as_of
        "#,
        user_id,
        from,
        to,
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
    pub currency: String,
    pub account_id: Uuid,
    pub account_name: String,
    pub account_color: Option<String>,
    /// Stable category key (`cash`, `pea`, …); the frontend translates it,
    /// falling back to `category_label`.
    pub category_key: String,
    /// English category label from the reference table — the i18n fallback.
    pub category_label: String,
    pub quantity: Decimal,
    pub cost_basis: Decimal,
    pub price: Option<Decimal>,
    /// Last 30 daily unit prices, ascending by time. Empty if none.
    pub spark: Vec<Decimal>,
    /// ETF/fund country and sector breakdown, when available in instrument.meta.
    pub composition: Option<crate::dto::Composition>,
}

pub async fn holdings(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<HoldingRow>, CoreError> {
    struct Base {
        holding_id: Uuid,
        symbol: Option<String>,
        instrument_name: String,
        kind: String,
        logo_url: Option<String>,
        currency: String,
        instrument_id: Uuid,
        account_id: Uuid,
        account_name: String,
        account_color: Option<String>,
        category_key: String,
        category_label: String,
        quantity: Decimal,
        cost_basis: Decimal,
        price: Option<Decimal>,
        composition: Option<serde_json::Value>,
    }

    let bases = sqlx::query_as!(
        Base,
        r#"
        select h.id            as "holding_id!",
               i.symbol,
               i.name          as "instrument_name!",
               i.kind          as "kind!",
               i.logo_url,
               i.meta->'composition' as "composition?",
               i.currency      as "currency!",
               i.id            as "instrument_id!",
               a.id            as "account_id!",
               a.name          as "account_name!",
               a.color         as "account_color",
               cat.key         as "category_key!",
               cat.label       as "category_label!",
               h.quantity      as "quantity!",
               h.cost_basis    as "cost_basis!",
               (select p.unit_price from price p
                  where p.instrument_id = i.id order by p.ts desc limit 1) as "price?"
        from holding h
        join account a      on a.id = h.account_id
        join connection c   on c.id = a.connection_id
        join instrument i   on i.id = h.instrument_id
        join account_type t on t.key = a.type_key
        join category cat   on cat.key = t.category_key
        where c.user_id = $1 and h.quantity <> 0
        order by h.id
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(bases.len());
    for b in bases {
        // Last 30 prices, newest-first, then reversed to ascending.
        let mut spark: Vec<Decimal> = sqlx::query_scalar!(
            r#"select unit_price as "unit_price!" from price where instrument_id = $1 order by ts desc limit 30"#,
            b.instrument_id,
        )
        .fetch_all(pool)
        .await?;
        spark.reverse();

        out.push(HoldingRow {
            holding_id: b.holding_id,
            symbol: b.symbol,
            instrument_name: b.instrument_name,
            kind: b.kind,
            logo_url: b.logo_url,
            currency: b.currency,
            account_id: b.account_id,
            account_name: b.account_name,
            account_color: b.account_color,
            category_key: b.category_key,
            category_label: b.category_label,
            quantity: b.quantity,
            cost_basis: b.cost_basis,
            price: b.price,
            spark,
            composition: b.composition.and_then(|v| serde_json::from_value(v).ok()),
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

pub struct TxnRow {
    pub ts: DateTime<Utc>,
    pub quantity: Option<Decimal>,
    pub unit_price: Option<Decimal>,
    pub amount: Decimal,
}

pub async fn holding_transactions(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    holding_id: Uuid,
) -> Result<Vec<TxnRow>, CoreError> {
    let rows = sqlx::query_as!(
        TxnRow,
        r#"
        select t.ts as "ts!", t.quantity, t.unit_price, t.amount as "amount!"
        from transaction t
        join holding h    on h.account_id = t.account_id and h.instrument_id = t.instrument_id
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where h.id = $1 and c.user_id = $2 and t.type in ('buy', 'sell')
        order by t.ts
        "#,
        holding_id,
        user_id,
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
        -- Value each holding from its latest snapshot's quantity and the price
        -- series (price_asof at UTC today), falling back to the provider valuation
        -- (snapshot.value) when no price exists — the same rule as the net-worth
        -- series, so the accounts grid sums to the chart's current figure.
        with latest as (
            select distinct on (hs.holding_id)
                   hs.holding_id,
                   case
                       when i.kind = 'cash' then hs.quantity
                       else coalesce(hs.quantity * price_asof(i.id, (now() at time zone 'utc')::date), hs.value, 0)
                   end as value
            from holding_snapshot hs
            join holding h    on h.id = hs.holding_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
            join instrument i on i.id = h.instrument_id
            where c.user_id = $1
            order by hs.holding_id, hs.as_of desc
        )
        select a.id    as "account_id!",
               a.name  as "name!",
               a.color,
               a.type_key as "type_key!",
               t.label as "type_label!",
               sum(l.value) as "value!",
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
    let rows = sqlx::query_as!(
        AccountSeriesRow,
        r#"
        -- Same valuation as net_worth_series (snapshot-anchored quantity via the
        -- lateral join + price_asof), grouped per account for the stacked area.
        with dates as (
            select generate_series($2::date, $3::date, '1 day'::interval)::date as as_of
        )
        select a.id   as "account_id!",
               a.name as "name!",
               a.color as "color",
               d.as_of as "as_of!",
               coalesce(sum(
                   case
                       when i.kind = 'cash' then snap.quantity
                       else coalesce(snap.quantity * price_asof(i.id, d.as_of), snap.value, 0)
                   end
               ), 0) as "value!"
        from dates d
        cross join holding h
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        join instrument i on i.id = h.instrument_id
        join lateral (
            select hs.quantity, hs.value
            from holding_snapshot hs
            where hs.holding_id = h.id and hs.as_of <= d.as_of
            order by hs.as_of desc
            limit 1
        ) snap on true
        where c.user_id = $1
        group by a.id, a.name, a.color, d.as_of
        order by d.as_of, a.id
        "#,
        user_id,
        from,
        to,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub struct AccountTypeRow {
    pub key: String,
    pub label: String,
    pub category_key: String,
    pub category_label: String,
}

/// All account types from the reference table (joined to category), ordered by
/// label. New types are data inserts here — no code change needed to surface
/// them in the edit-account dropdown.
pub async fn account_types(pool: &sqlx::PgPool) -> Result<Vec<AccountTypeRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountTypeRow,
        r#"
        select t.key     as "key!",
               t.label   as "label!",
               cat.key   as "category_key!",
               cat.label as "category_label!"
        from account_type t
        join category cat on cat.key = t.category_key
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
    pub category_key: String,
    pub category_label: String,
    pub value: Decimal,
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
        with latest as (
            select distinct on (hs.holding_id)
                   hs.holding_id,
                   case
                       when i.kind = 'cash' then hs.quantity
                       else coalesce(hs.quantity * price_asof(i.id, (now() at time zone 'utc')::date), hs.value, 0)
                   end as value
            from holding_snapshot hs
            join holding h    on h.id = hs.holding_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
            join instrument i on i.id = h.instrument_id
            where c.user_id = $1
            order by hs.holding_id, hs.as_of desc
        )
        select a.id   as "account_id!",
               a.name as "name!",
               a.color,
               cat.key   as "category_key!",
               cat.label as "category_label!",
               sum(l.value) as "value!"
        from latest l
        join holding h      on h.id = l.holding_id
        join account a      on a.id = h.account_id
        join account_type t on t.key = a.type_key
        join category cat   on cat.key = t.category_key
        group by a.id, a.name, a.color, cat.key, cat.label
        order by sum(l.value) desc
        "#,
        user_id,
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

/// Distinct non-cash instruments held (nonzero quantity) under a connection.
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
        order by i.name
        "#,
        connection_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
