use super::*;
use anyhow::ensure;
use gripsou_core::repo::query;
pub async fn execute(c: &PreparedCase, p: &sqlx::PgPool) -> anyhow::Result<Execution> {
    let f = &c.fixture;
    match c.case.id.as_str() {
        "transactions.counts" => {
            timed(async { Ok(query::transaction_counts(p, f.user_id, &c.filters).await?) }).await
        }
        "transactions.matching-ids" => {
            timed(async { Ok(query::matching_transaction_ids(p, f.user_id, &c.filters).await?) })
                .await
        }
        "transactions.tags" => {
            let ids: Vec<_> = (0..200.min(f.config.transactions))
                .map(|n| crate::fixture::id(7, 0, n))
                .collect();
            timed(async { Ok(query::tags_for_transactions(p, f.user_id, &ids).await?) }).await
        }
        _ => timed(async { Ok(query::transactions(p, f.user_id, &c.filters).await?) }).await,
    }
}
pub async fn verify(c: &PreparedCase, p: &sqlx::PgPool, out: &Value) -> anyhow::Result<()> {
    // Independent fixture oracle: cash and lot identities/amounts directly from
    // persisted inputs, without budget_transaction_matches or valuation code.
    let rows:Vec<(uuid::Uuid,chrono::DateTime<chrono::Utc>,rust_decimal::Decimal)>=sqlx::query_as("with rows as (select t.id,t.ts,t.amount,t.description,t.account_id,t.budget_category_id from transaction t join account a on a.id=t.account_id join connection k on k.id=a.connection_id where k.user_id=$1 union all select l.id,l.acquired_on::timestamp at time zone 'UTC',case l.side when 'buy' then -(l.quantity*l.unit_price+l.fee) else l.quantity*l.unit_price-l.fee end,i.symbol,h.account_id,null::uuid from lot l join holding h on h.id=l.holding_id join instrument i on i.id=h.instrument_id join account a on a.id=h.account_id join connection k on k.id=a.connection_id where k.user_id=$1) select id,ts,amount from rows r where ($2::text is null or description ilike '%'||$2||'%') and ($3::uuid is null or account_id=$3) and (cardinality($4::uuid[])=0 or budget_category_id=any($4)) and (cardinality($5::uuid[])=0 or (select count(*) from budget_transaction_tag where transaction_id=r.id and tag_id=any($5))=cardinality($5)) order by ts desc,id limit $6 offset $7")
        .bind(c.fixture.user_id).bind(&c.filters.search).bind(c.filters.account_id).bind(&c.filters.category_ids).bind(&c.filters.tag_ids).bind(c.filters.limit).bind(c.filters.offset).fetch_all(p).await?;
    let actual = out
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("transaction output must be array"))?;
    ensure!(actual.len() == rows.len(), "wrong transaction count");
    for (r, (id, ts, amount)) in actual.iter().zip(rows) {
        ensure!(
            r["id"] == serde_json::json!(id)
                && r["ts"] == serde_json::json!(ts)
                && decimal(&r["amount"])? == amount,
            "wrong transaction identity/order/amount"
        );
    }
    if c.case.id == "transactions.search.rare" {
        ensure!(actual.len() == 1, "rare search must match one row");
    }
    if c.case.id == "transactions.filters.combined" {
        ensure!(
            !actual.is_empty(),
            "combined filter fixture must be nonempty"
        );
    }
    Ok(())
}
