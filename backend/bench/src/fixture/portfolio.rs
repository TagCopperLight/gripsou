use super::*;
pub async fn seed(pool: &PgPool, c: &FixtureConfig) -> Result<()> {
    let today = NaiveDate::parse_from_str(&c.anchor, "%Y-%m-%d")?;
    let start = today - Duration::days(c.days);
    let securities = c.holdings - c.accounts;
    sqlx::query("insert into instrument(id,kind,name,currency) select bench_id(8,0,n-1),'cash',v,v from unnest($1::text[]) with ordinality x(v,n)")
        .bind(&c.currencies).execute(pool).await?;
    sqlx::query("insert into instrument(id,kind,symbol,name,currency) select bench_id(9,0,n),'equity','BENCH'||n,'Benchmark equity '||n,($2::text[])[1+n%array_length($2,1)] from generate_series(0,$1::int-1) n")
        .bind(securities as i32).bind(&c.currencies).execute(pool).await?;
    sqlx::query("insert into price(instrument_id,ts,unit_price,currency) select i.id,d::timestamptz,case i.currency when 'EUR' then 1 when 'USD' then 0.9 else 1.2 end,'EUR' from instrument i cross join generate_series($1::date,$2::date,($3::text||' days')::interval) d where i.kind='cash' and (i.currency='EUR' or d >= $1::date+60)")
        .bind(start).bind(today).bind(c.price_stride.to_string()).execute(pool).await?;
    sqlx::query("insert into price(instrument_id,ts,unit_price,currency) select i.id,d::timestamptz,12,i.currency from instrument i cross join generate_series($1::date,$2::date,($3::text||' days')::interval) d where i.kind<>'cash' and ($4::int=0 or ((d::date-$1::date)/$3::int)%$4<>0)")
        .bind(start).bind(today).bind(c.price_stride.to_string()).bind(c.missing_price_every as i32).execute(pool).await?;
    sqlx::query("insert into holding(id,account_id,instrument_id,quantity,cost_basis) select bench_id(4,u,n),bench_id(3,u,n),bench_id(8,0,n%$3),10000+(select coalesce(sum(amount),0) from transaction where account_id=bench_id(3,u,n)),10000 from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int-1) n")
        .bind(c.users as i32).bind(c.accounts as i32).bind(c.currencies.len() as i32).execute(pool).await?;
    sqlx::query("insert into holding(id,account_id,instrument_id,quantity,cost_basis) select bench_id(4,u,$3+n),bench_id(3,u,n%$3),bench_id(9,0,n),case when n=0 then 0 else $4::int/2*90 end,case when n=0 then 0 else $4::int/2*1080 end from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int-1) n")
        .bind(c.users as i32).bind(securities as i32).bind(c.accounts as i32).bind(c.lots_per_security as i32).execute(pool).await?;
    sqlx::query("insert into lot(id,holding_id,side,acquired_on,quantity,unit_price,fee,source,external_id) select bench_id(10,u,n*$3+j),bench_id(4,u,$4+n),case when j%2=0 then 'buy' else 'sell' end,$5::date + case when j%2=0 then 10+(j/2)*($6-30)/($3/2) else 20+(j/2)*($6-30)/($3/2) end,case when j%2=0 or n=0 then 100 else 10 end,12,1,'manual','lot-'||n||'-'||j from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int-1) n cross join generate_series(0,$3::int-1) j")
        .bind(c.users as i32).bind(securities as i32).bind(c.lots_per_security as i32).bind(c.accounts as i32).bind(start).bind(c.days as i32).execute(pool).await?;
    sqlx::query("insert into holding_snapshot(holding_id,as_of,quantity,value) select h.id,d::date,q.qty,case when i.kind='cash' then q.qty else q.qty*12 end from holding h join instrument i on i.id=h.instrument_id cross join (select generate_series($1::date,$2::date,($3::text||' days')::interval) as d union select $2::timestamptz) dates cross join lateral (select case when i.kind='cash' then 10000+(select coalesce(sum(t.amount),0) from transaction t where t.account_id=h.account_id and t.booked_on<=d::date) else (select coalesce(sum(case l.side when 'buy' then l.quantity else -l.quantity end),0) from lot l where l.holding_id=h.id and l.acquired_on<=d::date) end as qty) q")
        .bind(start).bind(today).bind(c.snapshot_stride.to_string()).execute(pool).await?;
    Ok(())
}
