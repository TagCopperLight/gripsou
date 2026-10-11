use super::*;
use anyhow::ensure;
use gripsou_core::{
    dto::SyncResult,
    repo::budget::{ai, assign},
};
use rust_decimal::Decimal;
use uuid::Uuid;
pub struct Input {
    ids: Vec<Uuid>,
    sync: SyncResult,
    description_ids: Vec<Uuid>,
    before: Value,
}
async fn cash_state(pool: &sqlx::PgPool) -> anyhow::Result<Value> {
    type CashState = (
        Uuid,
        Decimal,
        Option<Uuid>,
        Option<String>,
        bool,
        Option<Uuid>,
    );
    let rows:Vec<CashState>=sqlx::query_as("select id,amount,budget_category_id,category_source,checked_at is not null,transfer_pair_id from transaction order by id").fetch_all(pool).await?;
    Ok(serde_json::to_value(rows)?)
}
async fn pair(p: &sqlx::PgPool, u: Uuid) -> anyhow::Result<usize> {
    let mut t = p.begin().await?;
    sqlx::query("select pg_advisory_xact_lock(hashtext($1))")
        .bind(u.to_string())
        .execute(&mut *t)
        .await?;
    let n = gripsou_core::budget::pairing::pair_internal_transfers(&mut t, u).await?;
    t.commit().await?;
    Ok(n)
}
pub async fn prepare(case: &Case, p: &sqlx::PgPool, f: &Fixture) -> anyhow::Result<Input> {
    let ids = (0..1000.min(f.config.transactions))
        .map(|n| crate::fixture::id(7, 0, n))
        .collect();
    let mut sync = f.syncs[0].1.clone();
    match case.id.as_str() {
        "sync.ingest.first" => {
            sqlx::query("delete from account where connection_id=$1")
                .bind(f.syncs[0].0)
                .execute(p)
                .await?;
        }
        "sync.ingest.corrected" => {
            sync.transactions[0].amount += Decimal::ONE;
        }
        "transfers.pair.unchanged" => {
            pair(p, f.user_id).await?;
        }
        "prices.insert.first" => {
            sqlx::query("delete from price where instrument_id=(select instrument_id from holding where id=$1)").bind(f.holding_id).execute(p).await?;
        }
        "prices.refresh.fresh" => {
            sqlx::query("insert into price(instrument_id,ts,unit_price,currency) select distinct h.instrument_id,$1::date::timestamptz,case i.kind when 'cash' then 1 else 12 end,i.currency from holding h join instrument i on i.id=h.instrument_id on conflict(instrument_id,ts) do nothing").bind(f.today()).execute(p).await?;
        }
        _ => {}
    }
    let description_ids = if case.id == "transactions.apply-description" {
        let ids: Vec<Uuid> = sqlx::query_scalar(
            "select t.id from transaction t join account a on a.id=t.account_id \
             join connection c on c.id=a.connection_id \
             where c.user_id=$1 and t.description='Market groceries' order by t.id",
        )
        .bind(f.user_id)
        .fetch_all(p)
        .await?;
        ensure!(!ids.is_empty(), "fixture has no grocery transactions");
        ids
    } else {
        Vec::new()
    };
    Ok(Input {
        ids,
        sync,
        description_ids,
        before: cash_state(p).await?,
    })
}
pub async fn execute(c: &PreparedCase, p: &sqlx::PgPool) -> anyhow::Result<Execution> {
    let f = &c.fixture;
    let input = c.mutation.as_ref().unwrap();
    match c.case.id.as_str() {
        "portfolio.backfill" => {
            let mut e = timed(async {
                let mut conn = p.acquire().await?;
                Ok(gripsou_core::backfill::backfill_connection(&mut conn, f.syncs[0].0).await?)
            })
            .await?;
            let state = backfill_state(p, f.syncs[0].0).await?;
            e.outcome = serde_json::json!({"rows_written": e.outcome, "state": state});
            Ok(e)
        }
        "transactions.bulk.category" | "transactions.bulk.tags" | "transactions.bulk.checked" => {
            timed(async {
                let tags = [crate::fixture::id(6, 0, 1)];
                let changes = assign::BulkChanges {
                    category_id: if c.case.id.ends_with("category") {
                        Some(Some(f.category_id))
                    } else {
                        None
                    },
                    add_tag_ids: if c.case.id.ends_with("tags") {
                        Some(&tags)
                    } else {
                        None
                    },
                    checked: if c.case.id.ends_with("checked") {
                        Some(true)
                    } else {
                        None
                    },
                };
                match assign::bulk_apply(p, f.user_id, &input.ids, changes, true).await? {
                    assign::WriteOutcome::Done(n) => Ok(n),
                    other => anyhow::bail!("bulk refused: {other:?}"),
                }
            })
            .await
        }
        "transactions.apply-description" => {
            timed(async {
                match assign::apply_to_description(
                    p,
                    f.user_id,
                    input.description_ids[0],
                    Some(f.category_id),
                    assign::SameDescription::All,
                    true,
                )
                .await?
                {
                    assign::WriteOutcome::Done(mut ids) => {
                        ids.sort();
                        Ok(ids)
                    }
                    other => anyhow::bail!("description refused: {other:?}"),
                }
            })
            .await
        }
        "sync.ingest.first" | "sync.ingest.unchanged" | "sync.ingest.corrected" => {
            timed(async { Ok(gripsou_core::ingest::ingest(p, f.syncs[0].0, &input.sync).await?) })
                .await
        }
        "transfers.pair.first" | "transfers.pair.unchanged" | "transfers.pair.ambiguous" => {
            timed(pair(p, f.user_id)).await
        }
        "ai.prepare" => {
            timed(async {
                let rows = ai::work_chunk(p, f.user_id, &[], 50).await?;
                let ids = rows.iter().map(|r| r.id).collect::<Vec<_>>();
                let examples = ai::examples_for(p, f.user_id, &ids).await?;
                let corrections = ai::recent_corrections(p, f.user_id, 20).await?;
                Ok(serde_json::json!({"rows":rows,"examples":examples,"corrections":corrections}))
            })
            .await
        }
        "ai.persist" => {
            let decisions = (101..121)
                .map(|n| gripsou_core::budget::ai::Decision {
                    txn_id: crate::fixture::id(7, 0, n),
                    category_id: Some(if n == 101 { Uuid::nil() } else { f.category_id }),
                    confidence: Some(Decimal::new(9, 1)),
                })
                .chain(std::iter::once(gripsou_core::budget::ai::Decision {
                    txn_id: crate::fixture::id(7, 1, 101),
                    category_id: Some(f.category_id),
                    confidence: Some(Decimal::ONE),
                }))
                .collect::<Vec<_>>();
            timed(async { Ok(ai::write_decisions(p, f.user_id, &decisions).await?) }).await
        }
        "prices.insert.first" | "prices.insert.duplicate" => {
            timed(async {
                let mut conn = p.acquire().await?;
                let instrument: Uuid =
                    sqlx::query_scalar("select instrument_id from holding where id=$1")
                        .bind(f.holding_id)
                        .fetch_one(&mut *conn)
                        .await?;
                let points = (0..100)
                    .map(|n| {
                        (
                            (f.today() - chrono::Duration::days(n))
                                .and_hms_opt(0, 0, 0)
                                .unwrap()
                                .and_utc(),
                            Decimal::from(12),
                        )
                    })
                    .collect::<Vec<_>>();
                Ok(
                    gripsou_core::repo::price::insert_prices(&mut conn, instrument, &points, "EUR")
                        .await?,
                )
            })
            .await
        }
        "prices.refresh.fresh" => {
            timed(async {
                let providers: Vec<Box<dyn gripsou_core::provider::PriceProvider>> =
                    vec![Box::new(crate::offline::FreshOnly)];
                Ok(gripsou_core::price_sync::fetch_prices_for_connection_at(
                    p,
                    f.syncs[0].0,
                    &providers,
                    f.today(),
                )
                .await?)
            })
            .await
        }
        _ => anyhow::bail!("unknown mutation"),
    }
}
pub async fn verify(c: &PreparedCase, p: &sqlx::PgPool, e: &Execution) -> anyhow::Result<()> {
    let f = &c.fixture;
    let input = c.mutation.as_ref().unwrap();
    let after = cash_state(p).await?;
    match c.case.id.as_str() {
        "transactions.bulk.category" | "transactions.bulk.checked" | "transactions.bulk.tags" => {
            ensure!(
                e.outcome.as_u64() == Some(input.ids.len() as u64),
                "wrong write count"
            );
            for (a, b) in after
                .as_array()
                .unwrap()
                .iter()
                .zip(input.before.as_array().unwrap())
            {
                let id: Uuid = serde_json::from_value(a[0].clone())?;
                if input.ids.contains(&id) {
                    ensure!(a[1] == b[1], "write altered amount");
                    if c.case.id.ends_with("category") {
                        ensure!(
                            a[2] == serde_json::json!(f.category_id) && a[3] == "user",
                            "category write missing"
                        );
                    } else if c.case.id.ends_with("checked") {
                        ensure!(a[4] == true, "check write missing");
                    } else {
                        let exists:bool=sqlx::query_scalar("select exists(select 1 from budget_transaction_tag where transaction_id=$1 and tag_id=$2)").bind(id).bind(crate::fixture::id(6,0,1)).fetch_one(p).await?;
                        ensure!(exists, "tag write missing");
                    }
                } else {
                    ensure!(a == b, "write touched non-target");
                }
            }
        }
        "transactions.apply-description" => {
            ensure!(
                e.outcome == serde_json::json!(input.description_ids),
                "description write returned wrong transaction IDs"
            );
            ensure!(
                after.as_array().unwrap().len() == input.before.as_array().unwrap().len(),
                "description write changed transaction count"
            );
            for (a, b) in after
                .as_array()
                .unwrap()
                .iter()
                .zip(input.before.as_array().unwrap())
            {
                let id: Uuid = serde_json::from_value(a[0].clone())?;
                if input.description_ids.binary_search(&id).is_ok() {
                    ensure!(
                        a[1] == b[1] && a[4] == b[4] && a[5] == b[5],
                        "description write altered unrelated fields"
                    );
                    ensure!(
                        a[2] == serde_json::json!(f.category_id) && a[3] == "user",
                        "description category write missing"
                    );
                } else {
                    ensure!(a == b, "description write touched non-target");
                }
            }
        }
        "sync.ingest.unchanged" => {
            ensure!(
                e.outcome["transactions_inserted"] == 0,
                "unchanged ingest inserted"
            );
            ensure!(
                after.as_array().unwrap().len() == input.before.as_array().unwrap().len(),
                "unchanged ingest changed count"
            );
        }
        "sync.ingest.corrected" => {
            ensure!(
                e.outcome["transactions_inserted"] == 0,
                "corrected ingest inserted"
            );
            let a = &after[0];
            let b = &input.before[0];
            ensure!(
                decimal(&a[1])? == decimal(&b[1])? + Decimal::ONE && a[2] == b[2] && a[3] == b[3],
                "correction lost user metadata"
            );
        }
        "sync.ingest.first" => {
            ensure!(
                e.outcome["transactions_inserted"].as_u64()
                    == Some(input.sync.transactions.len() as u64),
                "first ingest mismatch"
            );
        }
        "transfers.pair.first" | "transfers.pair.unchanged" | "transfers.pair.ambiguous" => {
            let rows: Vec<(Uuid, Option<Uuid>)> =
                sqlx::query_as("select id,transfer_pair_id from transaction order by id")
                    .fetch_all(p)
                    .await?;
            for (id, paired) in &rows {
                if let Some(other) = paired {
                    ensure!(
                        rows.iter()
                            .any(|(i, j)| i == other && j.as_ref() == Some(id)),
                        "asymmetric pair"
                    );
                }
            }
            for g in 0..f.config.transactions / f.config.transfer_fraction / 3 {
                if g % f.config.ambiguous_every == 0 {
                    ensure!(
                        rows.iter()
                            .find(|(id, _)| *id == crate::fixture::id(7, 0, g * 3))
                            .unwrap()
                            .1
                            .is_none(),
                        "ambiguous transfer paired"
                    );
                }
            }
            if c.case.id.ends_with("unchanged") {
                ensure!(e.outcome == 0, "repeat pairing wrote new pairs");
            } else {
                ensure!(e.outcome.as_u64().unwrap_or(0) > 0, "pairing did no work");
            }
        }
        "prices.insert.first" | "prices.insert.duplicate" => {
            ensure!(e.outcome == 100, "price count wrong");
            let n:i64=sqlx::query_scalar("select count(*) from price where instrument_id=(select instrument_id from holding where id=$1) and ts>=$2::date::timestamptz and unit_price=12").bind(f.holding_id).bind(f.today()-chrono::Duration::days(99)).fetch_one(p).await?;
            ensure!(n == 100, "stored price values wrong");
        }
        "prices.refresh.fresh" => {
            ensure!(
                e.outcome["skipped_fresh"].as_u64().unwrap_or(0) > 0
                    && e.outcome["prices_inserted"] == 0,
                "fresh price path failed"
            );
        }
        "portfolio.backfill" => {
            // Generate the expected fixture history from cash inputs and signed
            // lot quantities, independently of the backward-walk implementation.
            let (expected, bad): (i64, i64) = sqlx::query_as(r#"
                with expected as (
                  select h.id, d::date as day, i.kind, h.cost_basis,
                    (select min(s.as_of) from holding_snapshot s where s.holding_id=h.id and s.as_of>d::date) as anchor,
                    exists(select 1 from holding_snapshot s where s.holding_id=h.id and s.quantity<>0) as valued,
                    case when i.kind='cash' then 10000 + (select coalesce(sum(t.amount),0) from transaction t where t.account_id=h.account_id and t.booked_on<=d::date)
                    else (select coalesce(sum(case l.side when 'buy' then l.quantity else -l.quantity end),0) from lot l where l.holding_id=h.id and l.acquired_on<=d::date) end as qty
                  from holding h join account a on a.id=h.account_id join instrument i on i.id=h.instrument_id
                  cross join generate_series($2::date,$3::date,interval '1 day') d
                  where a.connection_id=$1 and not exists(select 1 from holding_snapshot s where s.holding_id=h.id and s.as_of=d::date)
                ), adjusted as (select *, qty+greatest(0,-min(qty) over(partition by id,anchor)) as adjusted_qty from expected)
                select count(*), count(*) filter(where b.holding_id is null or b.quantity<>e.adjusted_qty or b.value<>case when e.kind='cash' then e.adjusted_qty when e.valued then e.adjusted_qty*12 else e.cost_basis end)
                from adjusted e left join holding_backfill b on b.holding_id=e.id and b.as_of=e.day
            "#).bind(f.syncs[0].0).bind(f.from()-chrono::Duration::days(1)).bind(f.today()).fetch_one(p).await?;
            let actual: i64 = sqlx::query_scalar("select count(*) from holding_backfill b join holding h on h.id=b.holding_id join account a on a.id=h.account_id where a.connection_id=$1").bind(f.syncs[0].0).fetch_one(p).await?;
            ensure!(
                bad == 0
                    && expected == actual
                    && e.outcome["rows_written"].as_i64() == Some(actual),
                "wrong derived backfill coverage/quantity/value: expected={expected} actual={actual} bad={bad}"
            );
            ensure!(
                e.outcome["state"] == backfill_state(p, f.syncs[0].0).await?,
                "backfill state changed after execution"
            );
        }
        "ai.prepare" => {
            ensure!(
                !e.outcome["rows"].as_array().unwrap().is_empty(),
                "no AI preparation work"
            );
        }
        "ai.persist" => {
            ensure!(
                e.outcome.as_u64().unwrap_or(0) > 0,
                "no AI decisions written"
            );
            ensure!(after[101][2].is_null(), "deleted category persisted");
        }
        _ => anyhow::bail!("mutation missing correctness check"),
    }
    Ok(())
}

async fn backfill_state(p: &sqlx::PgPool, connection: uuid::Uuid) -> anyhow::Result<String> {
    let rows: Vec<(uuid::Uuid, chrono::NaiveDate, rust_decimal::Decimal, rust_decimal::Decimal)> = sqlx::query_as("select b.holding_id,b.as_of,b.quantity,b.value from holding_backfill b join holding h on h.id=b.holding_id join account a on a.id=h.account_id where a.connection_id=$1 order by b.holding_id,b.as_of").bind(connection).fetch_all(p).await?;
    crate::report::fingerprint(&rows)
}
