use super::*;
use gripsou_core::{budget::overview as o, repo::budget::summary};
pub async fn execute(c: &PreparedCase, p: &sqlx::PgPool) -> anyhow::Result<Execution> {
    let f = &c.fixture;
    match c.case.id.as_str() {
        "budget.day-totals" => {
            let mut result = timed(async {
                Ok(summary::day_category_totals(p, f.user_id, f.from(), f.today()).await?)
            })
            .await?;
            // Positive and negative uncategorised buckets can share a day/category.
            // Their SQL ordering is unspecified. Canonicalise the complete rows
            // outside the timer without dropping any values or duplicates.
            result
                .outcome
                .as_array_mut()
                .unwrap()
                .sort_by_cached_key(Value::to_string);
            Ok(result)
        }
        "budget.overview.projection" => {
            timed(async {
                let buckets = o::by_month(&c.budget_rows);
                let month = o::Month::containing(f.today());
                let rows = o::month_rows(&buckets, month);
                let baseline = o::baseline_in(&buckets, month);
                Ok(Projection {
                    figures: o::figures(rows),
                    sankey: o::sankey(rows),
                    breakdown: o::breakdown(rows, baseline.as_ref()),
                    baseline: baseline.as_ref().map(o::baseline_figures),
                })
            })
            .await
        }
        "budget.trend.projection" => {
            timed(async {
                Ok(o::trend(
                    &c.budget_rows,
                    o::Month::containing(f.today()),
                    12,
                    None,
                ))
            })
            .await
        }
        _ => anyhow::bail!("unknown budget operation"),
    }
}

#[derive(serde::Serialize)]
struct Projection {
    figures: o::Figures,
    sankey: o::Sankey,
    breakdown: Vec<o::BreakdownEntry>,
    baseline: Option<o::Figures>,
}
// Independent arithmetic over persisted fixture transactions and physical FX quotes.
pub async fn expected_figures(
    p: &sqlx::PgPool,
    f: &Fixture,
    month: o::Month,
) -> anyhow::Result<o::Figures> {
    let (from, to) = month.bounds();
    let (income, expenses): (rust_decimal::Decimal,rust_decimal::Decimal) = sqlx::query_as(r#"
      with raw as (
        select t.budget_category_id as category, bc.kind, t.amount * coalesce(afx.rate,0) / coalesce(nullif(rfx.rate,0),1) as amount
        from transaction t join account a on a.id=t.account_id join connection c on c.id=a.connection_id
        left join budget_category bc on bc.id=t.budget_category_id
        left join lateral (select pr.unit_price as rate from price pr join instrument i on i.id=pr.instrument_id where i.kind='cash' and i.currency=a.currency and pr.currency='EUR' and pr.ts::date<=t.ts::date order by pr.ts desc limit 1) afx on true
        left join lateral (select pr.unit_price as rate from price pr join instrument i on i.id=pr.instrument_id where i.kind='cash' and i.currency=$4 and pr.currency='EUR' and pr.ts::date<=t.ts::date order by pr.ts desc limit 1) rfx on true
        where c.user_id=$1 and t.ts::date between $2 and $3 and t.transfer_pair_id is null and coalesce(bc.kind,'')<>'neutral'
      ), groups as (select kind, sum(amount) as amount from raw group by category,kind,case when category is null then sign(amount) else 0 end)
      select coalesce(sum(greatest(amount,0)) filter(where kind='income' or kind is null),0), coalesce(sum(greatest(-amount,0)) filter(where kind='expense' or kind is null),0) from groups
    "#).bind(f.user_id).bind(from).bind(to).bind(&f.config.reporting_currency).fetch_one(p).await?;
    Ok(o::Figures {
        income,
        expenses,
        net: income - expenses,
    })
}
