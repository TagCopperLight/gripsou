use crate::{catalog::Case, fixture::Fixture};
use serde_json::Value;
pub struct Execution {
    pub elapsed: std::time::Duration,
    pub rows: usize,
    pub outcome: Value,
    pub batch_size: usize,
}
mod budget;
mod mutations;
mod portfolio;
mod returns;
mod transactions;
pub struct PreparedCase {
    pub mutation: Option<mutations::Input>,
    pub case: Case,
    pub fixture: Fixture,
    pub filters: gripsou_core::repo::query::TransactionFilters,
    pub budget_rows: Vec<gripsou_core::repo::budget::summary::DayCategoryRow>,
}
pub async fn prepare(
    case: &Case,
    pool: &sqlx::PgPool,
    fixture: &Fixture,
) -> anyhow::Result<PreparedCase> {
    let mut filters = gripsou_core::repo::query::TransactionFilters::unfiltered();
    match case.id.as_str() {
        "transactions.page.deep" => filters.offset = 10000,
        "transactions.search.common" => filters.search = Some("Market".into()),
        "transactions.search.rare" => filters.search = Some("Rare merchant 17".into()),
        "transactions.search.absent" => filters.search = Some("no-such-merchant".into()),
        "transactions.filters.combined" => {
            filters.account_id = Some(fixture.account_id);
            filters.category_ids = vec![fixture.category_id];
            filters.tag_ids = vec![fixture.tag_id];
            filters.from = Some(fixture.from());
            filters.to = Some(fixture.today());
        }
        _ => {}
    }
    let budget_rows = if case.id.contains("projection") {
        gripsou_core::repo::budget::summary::day_category_totals(
            pool,
            fixture.user_id,
            fixture.from(),
            fixture.today(),
        )
        .await?
    } else {
        vec![]
    };
    let mutation = if case.reset == "clone" {
        Some(mutations::prepare(case, pool, fixture).await?)
    } else {
        None
    };
    Ok(PreparedCase {
        mutation,
        case: case.clone(),
        fixture: fixture.clone(),
        filters,
        budget_rows,
    })
}
pub async fn timed<T: serde::Serialize>(
    future: impl std::future::Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<Execution> {
    let start = std::time::Instant::now();
    let result = future.await?;
    let elapsed = start.elapsed();
    let outcome = serde_json::to_value(result)?;
    let rows = outcome.as_array().map_or(1, Vec::len);
    Ok(Execution {
        elapsed,
        rows,
        outcome,
        batch_size: 1,
    })
}
pub async fn execute(case: &PreparedCase, pool: &sqlx::PgPool) -> anyhow::Result<Execution> {
    if case.mutation.is_some() {
        return mutations::execute(case, pool).await;
    }
    match case.case.id.split('.').next().unwrap() {
        "portfolio" | "prices" | "lots" => portfolio::execute(case, pool).await,
        "transactions" => transactions::execute(case, pool).await,
        "budget" => budget::execute(case, pool).await,
        "returns" => returns::execute(case, pool).await,
        _ => anyhow::bail!("unsupported case"),
    }
}
pub async fn verify(
    case: &PreparedCase,
    pool: &sqlx::PgPool,
    execution: &Execution,
) -> anyhow::Result<()> {
    use anyhow::ensure;
    if case.mutation.is_some() {
        return mutations::verify(case, pool, execution).await;
    }
    let f = &case.fixture;
    let out = &execution.outcome;
    if case.case.id == "returns.xirr.valid" {
        ensure!(
            (out.as_f64().unwrap_or(-999.) - 0.1).abs() < 1e-9,
            "wrong XIRR"
        );
    }
    if case.case.id == "returns.xirr.no-solution" {
        ensure!(out.is_null(), "no-solution XIRR must be None");
    }
    if case.case.id.starts_with("transactions.page")
        || case.case.id.contains("transactions.search")
        || case.case.id == "transactions.filters.combined"
    {
        transactions::verify(case, pool, out).await?;
    }
    if case.case.id == "portfolio.holdings" {
        let expected:Vec<(uuid::Uuid,rust_decimal::Decimal,String,String)>=sqlx::query_as("select h.id,h.quantity,i.kind,i.currency from holding h join account a on a.id=h.account_id join connection c on c.id=a.connection_id join instrument i on i.id=h.instrument_id where c.user_id=$1 and h.quantity<>0 order by h.id").bind(f.user_id).fetch_all(pool).await?;
        let rows = out
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("holdings must be array"))?;
        ensure!(rows.len() == expected.len(), "wrong holdings count");
        for (id, quantity, kind, currency) in expected {
            let row = rows
                .iter()
                .find(|r| r["holding_id"] == serde_json::json!(id))
                .ok_or_else(|| anyhow::anyhow!("wrong holding identity/owner"))?;
            ensure!(
                decimal(&row["quantity"])? == quantity,
                "wrong holding quantity"
            );
            let rate = |code: &str| match code {
                "USD" => rust_decimal::Decimal::new(9, 1),
                "GBP" => rust_decimal::Decimal::new(12, 1),
                _ => rust_decimal::Decimal::ONE,
            };
            let expected = quantity
                * if kind == "cash" {
                    rust_decimal::Decimal::ONE
                } else {
                    rust_decimal::Decimal::from(12)
                }
                * rate(&currency)
                / rate(&f.config.reporting_currency);
            ensure!(decimal(&row["value"])? == expected, "wrong holding value");
            if kind != "cash" {
                ensure!(
                    decimal(&row["mean_price"])? == rust_decimal::Decimal::new(1201, 2),
                    "fee-inclusive mean price changed"
                );
                ensure!(
                    decimal(&row["unexplained_quantity"])? == rust_decimal::Decimal::ZERO,
                    "lot coverage changed"
                );
            }
        }
    }
    if case.case.id == "portfolio.net-worth" {
        let rows = out
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("series must be array"))?;
        ensure!(
            !rows.is_empty()
                && rows.len() <= 401
                && rows.last().unwrap()["as_of"] == serde_json::json!(f.today()),
            "wrong chart axis"
        );
    }
    if case.case.id.starts_with("prices.history") {
        for r in out.as_array().unwrap() {
            ensure!(
                decimal(&r["unit_price"])? == rust_decimal::Decimal::from(12),
                "wrong price"
            );
        }
    }
    match case.case.id.as_str() {
        "portfolio.accounts" | "portfolio.distribution" => {
            let rows = out
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("accounts must be array"))?;
            ensure!(rows.len() == f.config.accounts, "wrong account count");
            for r in rows {
                let id: uuid::Uuid = serde_json::from_value(r["account_id"].clone())?;
                ensure!(
                    (0..f.config.accounts).any(|n| id == crate::fixture::id(3, 0, n)),
                    "foreign account"
                );
            }
        }
        "portfolio.account-series" => {
            let rows = out
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("series must be array"))?;
            ensure!(!rows.is_empty(), "empty account series");
            for r in rows {
                let id: uuid::Uuid = serde_json::from_value(r["account_id"].clone())?;
                ensure!(
                    (0..f.config.accounts).any(|n| id == crate::fixture::id(3, 0, n)),
                    "foreign account"
                );
            }
        }
        "returns.inputs" => {
            ensure!(
                out["today"] == serde_json::json!(f.today()),
                "wrong returns date"
            );
            ensure!(
                out["positions"].as_array().map(Vec::len)
                    == Some(f.config.holdings - f.config.accounts),
                "wrong returns positions"
            );
        }
        "lots.list" => {
            let rows = out
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("lots must be array"))?;
            ensure!(rows.len() == f.config.lots_per_security, "wrong lot count");
            for r in rows {
                ensure!(
                    decimal(&r["unit_price"])? == rust_decimal::Decimal::from(12)
                        && decimal(&r["fee"])? == rust_decimal::Decimal::ONE,
                    "wrong lot amount"
                );
            }
        }
        "lots.preview" => {
            ensure!(
                decimal(&out["mean_price"])? == rust_decimal::Decimal::new(1201, 2)
                    && decimal(&out["explained_qty"])? == rust_decimal::Decimal::from(100),
                "wrong preview basis"
            );
        }
        "lots.basis" => {
            ensure!(
                decimal(&out[0][0])? == rust_decimal::Decimal::new(1201, 2)
                    && decimal(&out[0][1])?
                        == rust_decimal::Decimal::from(90 * f.config.lots_per_security / 2),
                "wrong cost basis"
            );
        }
        "transactions.matching-ids" => {
            let rows = out
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("ids must be array"))?;
            ensure!(
                rows.len() == f.config.transactions,
                "wrong eligible cash count"
            );
            let mut ids = std::collections::BTreeSet::new();
            for r in rows {
                let id: uuid::Uuid = serde_json::from_value(r.clone())?;
                ensure!(
                    (0..f.config.transactions).any(|n| id == crate::fixture::id(7, 0, n))
                        && ids.insert(id),
                    "wrong eligible identity"
                );
            }
        }
        "budget.trend.projection" => {
            ensure!(
                out[0].as_array().map(Vec::len) == Some(12),
                "wrong trend period"
            );
        }
        _ => {}
    }
    Ok(())
}
pub fn decimal(value: &Value) -> anyhow::Result<rust_decimal::Decimal> {
    Ok(value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
        .parse()?)
}
