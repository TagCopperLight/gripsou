use super::*;
use gripsou_core::{budget::overview as o, repo::budget::summary};
pub async fn execute(c: &PreparedCase, p: &sqlx::PgPool) -> anyhow::Result<Execution> {
    let f = &c.fixture;
    match c.case.id.as_str(){
        "budget.day-totals"=>timed(async{Ok(summary::day_category_totals(p,f.user_id,f.from(),f.today()).await?)}).await,
        "budget.overview.projection"=>timed(async{let buckets=o::by_month(&c.budget_rows);let month=o::Month::containing(f.today());let rows=o::month_rows(&buckets,month);let baseline=o::baseline_in(&buckets,month);Ok(serde_json::json!({"figures":o::figures(rows),"sankey":o::sankey(rows),"breakdown":o::breakdown(rows,baseline.as_ref()),"baseline":baseline.as_ref().map(o::baseline_figures)}))}).await,
        "budget.trend.projection"=>timed(async{Ok(o::trend(&c.budget_rows,o::Month::containing(f.today()),12,None))}).await,
        _=>anyhow::bail!("unknown budget operation")
    }
}
