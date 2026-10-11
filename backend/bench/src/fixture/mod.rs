mod ledger;
mod portfolio;
use crate::config::FixtureConfig;
use anyhow::{Result, ensure};
use chrono::{Duration, NaiveDate};
use gripsou_core::dto::*;
use serde::Serialize;
use sqlx::{AssertSqlSafe, Executor, PgPool};
use uuid::Uuid;

pub fn id(kind: u32, user: usize, index: usize) -> Uuid {
    Uuid::from_u128(((kind as u128) << 96) | ((user as u128) << 64) | index as u128)
}
#[derive(Clone, Serialize)]
pub struct Fixture {
    pub config: FixtureConfig,
    pub user_id: Uuid,
    pub account_id: Uuid,
    pub holding_id: Uuid,
    pub category_id: Uuid,
    pub tag_id: Uuid,
    pub syncs: Vec<(Uuid, SyncResult)>,
}
impl Fixture {
    pub fn today(&self) -> NaiveDate {
        NaiveDate::parse_from_str(&self.config.anchor, "%Y-%m-%d").unwrap()
    }
    pub fn from(&self) -> NaiveDate {
        self.today() - Duration::days(self.config.days)
    }
}
pub async fn seed(pool: &PgPool, c: &FixtureConfig) -> Result<Fixture> {
    c.validate()?;
    let owned:bool=sqlx::query_scalar("select coalesce(shobj_description(oid,'pg_database'),'') like 'gripsou-bench:%' from pg_database where datname=current_database()").fetch_one(pool).await?;
    ensure!(
        owned,
        "fixture seeding requires a runner-owned scratch database"
    );
    pool.execute(AssertSqlSafe(format!("create or replace function user_today(p_user uuid,p_now timestamptz default now()) returns date language sql stable as $$select date '{}'$$",c.anchor))).await?;
    pool.execute(AssertSqlSafe("create function bench_id(k integer,u integer,i bigint) returns uuid language sql immutable as $$select (lpad(to_hex(k),8,'0')||lpad(to_hex(u),8,'0')||lpad(to_hex(i),16,'0'))::uuid$$".to_string())).await?;
    sqlx::query("insert into provider(key,display_name,kind,enabled) values ('bench','Benchmark','account',false)").execute(pool).await?;
    sqlx::query("update app_settings set enabled_providers='{}',base_currency='EUR',budget_ai_provider=null").execute(pool).await?;
    sqlx::query("insert into users(id,email,name,password_hash,prefs,welcomed_at) select bench_id(1,u,0),'bench-'||u||'@example.invalid','Benchmark '||u,'unusable',jsonb_build_object('currency',$2::text,'timeZone','Europe/Paris'),now() from generate_series(0,$1::int-1) u")
        .bind(c.users as i32).bind(&c.reporting_currency).execute(pool).await?;
    // Seed triggers use random category IDs; replace before any references exist.
    sqlx::query("delete from budget_category")
        .execute(pool)
        .await?;
    sqlx::query("insert into budget_category(id,user_id,name,kind,color,system_key,sort_order) select bench_id(5,u,n),bench_id(1,u,0),case n when 0 then 'Benchmark Market' when 1 then 'Benchmark Income' when 2 then 'Internal transfer' else 'Category '||n end,case n when 1 then 'income' when 2 then 'neutral' else 'expense' end,'#72c27f',case n when 2 then 'internal_transfer' end,n+1 from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int-1) n")
        .bind(c.users as i32).bind(c.categories as i32).execute(pool).await?;
    sqlx::query("insert into budget_tag(id,user_id,name,created_at) select bench_id(6,u,n),bench_id(1,u,0),'Tag '||n,date '2026-01-01'+n from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int-1) n")
        .bind(c.users as i32).bind(c.tags as i32).execute(pool).await?;
    sqlx::query("insert into connection(id,user_id,provider_key,display_name) select bench_id(2,u,n),bench_id(1,u,0),'bench','Benchmark connection '||n from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int-1) n")
        .bind(c.users as i32).bind(c.connections as i32).execute(pool).await?;
    sqlx::query("insert into account(id,connection_id,name,currency,type_key,external_id) select bench_id(3,u,n),bench_id(2,u,n%$3),'Account '||n,($4::text[])[1+n%array_length($4,1)],case when n%2=0 then 'checking' else 'pea' end,'account-'||n from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int-1) n")
        .bind(c.users as i32).bind(c.accounts as i32).bind(c.connections as i32).bind(&c.currencies).execute(pool).await?;
    ledger::seed(pool, c).await?;
    portfolio::seed(pool, c).await?;
    let mut conn = pool.acquire().await?;
    for u in 0..c.users {
        for n in 0..c.connections {
            gripsou_core::backfill::backfill_connection(&mut conn, id(2, u, n)).await?;
        }
    }
    drop(conn);
    pool.execute(AssertSqlSafe("analyze".to_string())).await?;
    let syncs = recorded_syncs(pool, c).await?;
    Ok(Fixture {
        config: c.clone(),
        user_id: id(1, 0, 0),
        account_id: id(3, 0, 0),
        holding_id: id(4, 0, c.accounts + 1),
        category_id: id(5, 0, 0),
        tag_id: id(6, 0, 0),
        syncs,
    })
}
async fn recorded_syncs(pool: &PgPool, c: &FixtureConfig) -> Result<Vec<(Uuid, SyncResult)>> {
    let mut results = Vec::new();
    for n in 0..c.connections {
        let connection = id(2, 0, n);
        let accounts:Vec<(String,String,String,String)>=sqlx::query_as("select external_id,name,type_key,currency from account where connection_id=$1 order by id").bind(connection).fetch_all(pool).await?;
        let mut sync = SyncResult::default();
        for (external_id, name, type_key, currency) in accounts {
            sync.accounts.push(CanonicalAccount {
                external_id,
                name,
                type_key,
                currency,
                meta: serde_json::json!({}),
            });
        }
        type HoldingInput = (
            String,
            String,
            Option<String>,
            String,
            String,
            rust_decimal::Decimal,
            rust_decimal::Decimal,
            rust_decimal::Decimal,
        );
        let holdings:Vec<HoldingInput>=sqlx::query_as("select a.external_id,i.kind,i.symbol,i.name,i.currency,h.quantity,h.cost_basis,s.value from holding h join account a on a.id=h.account_id join instrument i on i.id=h.instrument_id join holding_snapshot s on s.holding_id=h.id and s.as_of=user_today($2) where a.connection_id=$1 order by h.id").bind(connection).bind(id(1,0,0)).fetch_all(pool).await?;
        for (account_external_id, kind, symbol, name, currency, quantity, cost_basis, valuation) in
            holdings
        {
            sync.holdings.push(CanonicalHolding {
                account_external_id,
                instrument: InstrumentRef {
                    kind,
                    symbol,
                    isin: None,
                    name,
                    currency,
                },
                quantity,
                cost_basis,
                valuation: Some(valuation),
            });
        }
        type TransactionInput = (
            String,
            String,
            String,
            chrono::DateTime<chrono::Utc>,
            rust_decimal::Decimal,
            Option<String>,
            Option<NaiveDate>,
        );
        let rows:Vec<TransactionInput>=sqlx::query_as("select a.external_id,t.external_id,t.type,t.ts,t.amount,t.description,t.booked_on from transaction t join account a on a.id=t.account_id where a.connection_id=$1 order by t.id").bind(connection).fetch_all(pool).await?;
        for (account_external_id, external_id, kind, ts, amount, description, booked_on) in rows {
            sync.transactions.push(CanonicalTransaction {
                account_external_id,
                external_id,
                kind,
                ts,
                quantity: None,
                unit_price: None,
                amount,
                fee: None,
                description,
                provider_meta: serde_json::json!({}),
                booked_on,
            });
        }
        results.push((connection, sync));
    }
    Ok(results)
}
