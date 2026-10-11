use super::*;
use gripsou_core::repo::{lot, lot_suggest, query};
pub async fn execute(c: &PreparedCase, p: &sqlx::PgPool) -> anyhow::Result<Execution> {
    let f = &c.fixture;
    match c.case.id.as_str(){
        "portfolio.net-worth"=>timed(async{Ok(query::net_worth_series(p,f.user_id,f.from(),f.today()).await?)}).await,
        "portfolio.account-series"=>timed(async{Ok(query::account_series(p,f.user_id,f.from(),f.today()).await?)}).await,
        "portfolio.distribution"=>timed(async{Ok(query::distribution(p,f.user_id).await?)}).await,
        "portfolio.holdings"=>timed(async{Ok(query::holdings(p,f.user_id).await?)}).await,
        "portfolio.accounts"=>timed(async{Ok(query::accounts(p,f.user_id).await?)}).await,
        "prices.history.short"|"prices.history.full"=>{let from=if c.case.id.ends_with("short"){f.today()-chrono::Duration::days(30)}else{f.from()};timed(async{Ok(query::holding_prices(p,f.user_id,f.holding_id,from.and_hms_opt(0,0,0).unwrap().and_utc(),f.today().and_hms_opt(23,59,59).unwrap().and_utc()).await?)}).await},
        "lots.list"=>timed(async{Ok(lot::list_lots(p,f.user_id,f.holding_id).await?)}).await,
        "lots.suggestions"=>timed(async{Ok(lot_suggest::suggest_lots(p,f.user_id,f.holding_id).await?)}).await,
        "lots.preview"=>{let rows=vec![lot::PreviewLot{side:"buy".into(),acquired_on:f.from()+chrono::Duration::days(10),quantity:rust_decimal::Decimal::from(100),unit_price:rust_decimal::Decimal::from(12),fee:rust_decimal::Decimal::ONE}];timed(async{Ok(lot::basis_preview(p,f.user_id,f.holding_id,&rows).await?)}).await},
        "lots.basis"=>timed(async{let x:Vec<(rust_decimal::Decimal,rust_decimal::Decimal,rust_decimal::Decimal,rust_decimal::Decimal)>=sqlx::query_as("select mean_price,explained_qty,basis,realised from lot_basis(array[$1]::uuid[],array[$2]::date[])").bind(f.holding_id).bind(f.today()).fetch_all(p).await?;Ok(x)}).await,
        _=>anyhow::bail!("unimplemented portfolio operation {}",c.case.id)
    }
}
