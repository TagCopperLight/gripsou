//! Read-side aggregations for the dashboard, all scoped by user_id
//! (joined via connection.user_id). Money stays Decimal end-to-end.

use chrono::NaiveDate;
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
        select hs.as_of as "as_of!",
               sum(hs.value)      as "net_worth!",
               sum(hs.cost_basis) as "invested!"
        from holding_snapshot hs
        join holding h    on h.id = hs.holding_id
        join account a    on a.id = h.account_id
        join connection c on c.id = a.connection_id
        where c.user_id = $1 and hs.as_of between $2 and $3
        group by hs.as_of
        order by hs.as_of
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
    pub category: String,
    pub quantity: Decimal,
    pub cost_basis: Decimal,
    pub price: Option<Decimal>,
    /// Last 30 daily unit prices, ascending by time. Empty if none.
    pub spark: Vec<Decimal>,
}

pub async fn holdings(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<HoldingRow>, CoreError> {
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
        category: String,
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
               cat.label       as "category!",
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
        where c.user_id = $1
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
            category: b.category,
            quantity: b.quantity,
            cost_basis: b.cost_basis,
            price: b.price,
            spark,
        });
    }
    Ok(out)
}

pub struct DistributionRow {
    pub account_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub category: String,
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
               cat.label as "category!",
               sum(l.value) as "value!"
        from latest l
        join holding h      on h.id = l.holding_id
        join account a      on a.id = h.account_id
        join account_type t on t.key = a.type_key
        join category cat   on cat.key = t.category_key
        group by a.id, a.name, a.color, cat.label
        order by sum(l.value) desc
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
