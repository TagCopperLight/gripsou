use super::*;
pub async fn seed(pool: &PgPool, c: &FixtureConfig) -> Result<()> {
    let today = NaiveDate::parse_from_str(&c.anchor, "%Y-%m-%d")?;
    let start = today - Duration::days(c.days);
    sqlx::query("insert into transaction(id,account_id,ts,booked_on,type,amount,description,external_id,budget_category_id,category_source,checked_at) select bench_id(7,u,n),bench_id(3,u,n%$3),($4::date+(n%($5+1))::int)::timestamptz + interval '12 hours', $4::date+(n%($5+1))::int,case when $6::int>0 and n%nullif($6,0)=$6-1 then 'dividend' when n%10=0 then 'deposit' else 'withdrawal' end,case when $6::int>0 and n%nullif($6,0)=$6-1 then 5 when n%10=0 then 300 else -(10+n%40) end,case when n=$2::int-17 then 'Rare merchant 17' when n%3=0 then 'Market groceries' else 'Merchant '||(n%30) end,'txn-'||n,case when n%4=0 then bench_id(5,u,case when n%10=0 then 1 else 0 end) end,case when n%4=0 then 'user' end,case when n%7=0 then $4::timestamptz end from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int-1) n")
        .bind(c.users as i32).bind(c.transactions as i32).bind(c.accounts as i32).bind(start).bind(c.days as i32).bind(c.dividend_stride as i32).execute(pool).await?;
    // Unique exact matches plus deliberately tied candidates, in the same currency.
    let groups = c.transactions / c.transfer_fraction / 3;
    sqlx::query("update transaction t set account_id=bench_id(3,u,case when n%3=0 then 0 else $4 end),type='transfer',booked_on=$5::date+(g%($6+1))::int,ts=($5::date+(g%($6+1))::int)::timestamptz+interval '12 hours',amount=case when n%3=0 then -(1000+g) else 1000+g end,budget_category_id=null,category_source=null,description='Benchmark transfer '||g from (select u,n,n/3 as g from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int*3-1) n where n%3<>2 or (n/3)%$3=0) x where t.id=bench_id(7,u,n)")
        .bind(c.users as i32).bind(groups as i32).bind(c.ambiguous_every as i32).bind(c.currencies.len() as i32).bind(start).bind(c.days as i32).execute(pool).await?;
    // One user-categorized transfer is intentionally ineligible for automatic pairing.
    sqlx::query("update transaction set budget_category_id=bench_id(5,u,0),category_source='user' from generate_series(0,$1::int-1) u where id=bench_id(7,u,3)").bind(c.users as i32).execute(pool).await?;
    sqlx::query("insert into budget_transaction_tag(transaction_id,tag_id) select bench_id(7,u,n),bench_id(6,u,n%$3) from generate_series(0,$1::int-1) u cross join generate_series(0,$2::int-1) n where n%3=0")
        .bind(c.users as i32).bind(c.transactions as i32).bind(c.tags as i32).execute(pool).await?;
    Ok(())
}
