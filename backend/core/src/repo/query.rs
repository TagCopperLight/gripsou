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
        with dates as (
            select generate_series($2::date, $3::date, '1 day'::interval)::date as as_of
        ),
        holdings_on_date as (
            select d.as_of,
                   h.id as holding_id,
                   coalesce(
                       (select quantity from holding_snapshot hs where hs.holding_id = h.id and hs.as_of <= d.as_of order by as_of desc limit 1),
                       h.quantity
                   ) as quantity,
                   coalesce(
                       (select cost_basis from holding_snapshot hs where hs.holding_id = h.id and hs.as_of <= d.as_of order by as_of desc limit 1),
                       h.cost_basis
                   ) as cost_basis,
                   (select value from holding_snapshot hs where hs.holding_id = h.id and hs.as_of <= d.as_of order by as_of desc limit 1) as snapshot_value,
                   i.kind,
                   i.id as instrument_id
            from dates d
            cross join holding h
            join account a on a.id = h.account_id
            join connection c on c.id = a.connection_id
            join instrument i on i.id = h.instrument_id
            where c.user_id = $1 and h.quantity <> 0
        ),
        daily_values as (
            select hd.as_of,
                   hd.cost_basis,
                   case
                       when hd.kind = 'cash' then hd.quantity
                       else coalesce(
                           hd.quantity * (select unit_price from price p where p.instrument_id = hd.instrument_id and p.ts::date <= hd.as_of order by ts desc limit 1),
                           hd.quantity * (select unit_price from price p where p.instrument_id = hd.instrument_id order by ts asc limit 1),
                           hd.snapshot_value,
                           0
                       )
                   end as value
            from holdings_on_date hd
        )
        select as_of as "as_of!",
               coalesce(sum(value), 0) as "net_worth!",
               coalesce(sum(cost_basis), 0) as "invested!"
        from daily_values
        group by as_of
        order by as_of
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
    }

    let bases = sqlx::query_as!(
        Base,
        r#"
        select h.id            as "holding_id!",
               i.symbol,
               i.name          as "instrument_name!",
               i.kind          as "kind!",
               i.logo_url,
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
}

/// One row per account: latest snapshot value per holding, summed, with the
/// account-type label and the connection's last sync time.
pub async fn accounts(pool: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<AccountRow>, CoreError> {
    let rows = sqlx::query_as!(
        AccountRow,
        r#"
        with latest as (
            select distinct on (hs.holding_id) hs.holding_id, hs.value
            from holding_snapshot hs
            join holding h    on h.id = hs.holding_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
            where c.user_id = $1
            order by hs.holding_id, hs.as_of desc
        )
        select a.id    as "account_id!",
               a.name  as "name!",
               a.color,
               a.type_key as "type_key!",
               t.label as "type_label!",
               sum(l.value) as "value!",
               c.last_sync_at
        from latest l
        join holding h      on h.id = l.holding_id
        join account a      on a.id = h.account_id
        join account_type t on t.key = a.type_key
        join connection c   on c.id = a.connection_id
        group by a.id, a.name, a.color, a.type_key, t.label, c.last_sync_at
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
        with dates as (
            select generate_series($2::date, $3::date, '1 day'::interval)::date as as_of
        ),
        holdings_on_date as (
            select d.as_of,
                   a.id as account_id,
                   a.name as account_name,
                   a.color as account_color,
                   h.id as holding_id,
                   coalesce(
                       (select quantity from holding_snapshot hs where hs.holding_id = h.id and hs.as_of <= d.as_of order by as_of desc limit 1),
                       h.quantity
                   ) as quantity,
                   (select value from holding_snapshot hs where hs.holding_id = h.id and hs.as_of <= d.as_of order by as_of desc limit 1) as snapshot_value,
                   i.kind,
                   i.id as instrument_id
            from dates d
            cross join holding h
            join account a on a.id = h.account_id
            join connection c on c.id = a.connection_id
            join instrument i on i.id = h.instrument_id
            where c.user_id = $1 and h.quantity <> 0
        ),
        daily_values as (
            select hd.as_of,
                   hd.account_id,
                   hd.account_name,
                   hd.account_color,
                   case
                       when hd.kind = 'cash' then hd.quantity
                       else coalesce(
                           hd.quantity * (select unit_price from price p where p.instrument_id = hd.instrument_id and p.ts::date <= hd.as_of order by ts desc limit 1),
                           hd.quantity * (select unit_price from price p where p.instrument_id = hd.instrument_id order by ts asc limit 1),
                           hd.snapshot_value,
                           0
                       )
                   end as value
            from holdings_on_date hd
        )
        select account_id as "account_id!",
               account_name as "name!",
               account_color as "color",
               as_of as "as_of!",
               coalesce(sum(value), 0) as "value!"
        from daily_values
        group by account_id, account_name, account_color, as_of
        order by as_of, account_id
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
}

/// Every user on the server, oldest first (the seeded admin sorts first).
/// Global, not user-scoped: the admin Users page lists everyone.
pub async fn users(pool: &sqlx::PgPool) -> Result<Vec<UserRow>, CoreError> {
    let rows = sqlx::query_as!(
        UserRow,
        r#"
        select id, name, email, role, created_at
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
        with latest as (
            select distinct on (hs.holding_id) hs.holding_id, hs.value
            from holding_snapshot hs
            join holding h    on h.id = hs.holding_id
            join account a    on a.id = h.account_id
            join connection c on c.id = a.connection_id
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
