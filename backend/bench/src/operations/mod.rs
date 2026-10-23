use crate::{catalog::Case, fixture::Fixture};
use serde_json::Value;
pub struct Execution {
    pub elapsed: std::time::Duration,
    pub rows: usize,
    pub outcome: Value,
    pub batch_size: usize,
}
mod budget;
pub mod http;
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
    let mut filters = gripsou_core::repo::query::TransactionFilters::default();
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
                let explained:rust_decimal::Decimal=sqlx::query_scalar("select coalesce(sum(case side when 'buy' then quantity else -quantity end),0) from lot where holding_id=$1").bind(id).fetch_one(pool).await?;
                ensure!(
                    decimal(&row["unexplained_quantity"])? == quantity - explained,
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
    if case.case.id == "transactions.counts" {
        let cash:i64=sqlx::query_scalar("select count(*) from transaction t join account a on a.id=t.account_id join connection c on c.id=a.connection_id where c.user_id=$1").bind(f.user_id).fetch_one(pool).await?;
        let lots = (f.config.holdings - f.config.accounts) * f.config.lots_per_security;
        ensure!(
            out["total"].as_i64() == Some(cash + lots as i64) && out["matching"] == out["total"],
            "wrong transaction totals"
        );
    }
    if case.case.id == "transactions.tags" {
        let expected = (0..200.min(f.config.transactions))
            .filter(|n| n % 3 == 0)
            .count();
        ensure!(
            out.as_object().map(serde_json::Map::len) == Some(expected),
            "wrong transaction tag count"
        );
        for (key, rows) in out.as_object().unwrap() {
            let id: uuid::Uuid = key.parse()?;
            ensure!(
                (0..200.min(f.config.transactions))
                    .any(|n| n % 3 == 0 && id == crate::fixture::id(7, 0, n)),
                "wrong tagged owner"
            );
            ensure!(
                rows.as_array().map(Vec::len) == Some(1),
                "wrong tag coverage"
            );
        }
    }
    if case.case.id == "budget.day-totals" {
        let rows = out
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("budget rows must be array"))?;
        ensure!(
            rows.iter()
                .map(|r| r["txn_count"].as_i64().unwrap_or(0))
                .sum::<i64>()
                == f.config.transactions as i64,
            "budget omitted cash rows"
        );
        if f.config.currencies.len() == 1 {
            let expected:rust_decimal::Decimal=sqlx::query_scalar("select sum(t.amount) from transaction t join account a on a.id=t.account_id join connection c on c.id=a.connection_id where c.user_id=$1").bind(f.user_id).fetch_one(pool).await?;
            let actual: rust_decimal::Decimal = rows
                .iter()
                .map(|r| decimal(&r["amount"]))
                .collect::<anyhow::Result<Vec<_>>>()?
                .into_iter()
                .sum();
            ensure!(actual == expected, "wrong budget aggregate amount");
        }
    }
    if case.case.id == "portfolio.net-worth" {
        let expected = fixture_value(pool, f, None).await?;
        let rows = out.as_array().unwrap();
        ensure!(
            decimal(&rows.last().unwrap()["net_worth"])? == expected,
            "wrong net worth amount"
        );
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
                ensure!(
                    decimal(&r["value"])? == fixture_value(pool, f, Some(id)).await?,
                    "wrong account value"
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
        "lots.suggestions" => ensure!(
            out.as_array().is_some_and(Vec::is_empty),
            "covered fixture must not suggest invented lots"
        ),
        "budget.overview.projection" => {
            let expected = budget::expected_figures(
                pool,
                f,
                gripsou_core::budget::overview::Month::containing(f.today()),
            )
            .await?;
            ensure!(
                out["figures"] == serde_json::to_value(expected)?,
                "wrong budget projection figures"
            );
            let sources = out["sankey"]["sources"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("missing Sankey sources"))?;
            let destinations = out["sankey"]["destinations"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("missing Sankey destinations"))?;
            let sum = |rows: &[Value]| -> anyhow::Result<rust_decimal::Decimal> {
                Ok(rows
                    .iter()
                    .map(|r| decimal(&r["amount"]))
                    .collect::<anyhow::Result<Vec<_>>>()?
                    .into_iter()
                    .sum())
            };
            ensure!(
                sum(sources)? == expected.income && sum(destinations)? == expected.expenses,
                "wrong Sankey totals"
            );
            ensure!(out["breakdown"].is_array(), "missing breakdown");
        }
        "returns.xirr.valid"
        | "returns.xirr.no-solution"
        | "portfolio.holdings"
        | "portfolio.net-worth"
        | "prices.history.short"
        | "prices.history.full"
        | "transactions.counts"
        | "transactions.tags"
        | "budget.day-totals"
        | "transactions.page.first"
        | "transactions.page.deep"
        | "transactions.search.common"
        | "transactions.search.rare"
        | "transactions.search.absent"
        | "transactions.filters.combined" => {}
        _ => anyhow::bail!("target missing correctness oracle: {}", case.case.id),
    }
    Ok(())
}
pub async fn fixture_value(
    pool: &sqlx::PgPool,
    f: &Fixture,
    account: Option<uuid::Uuid>,
) -> anyhow::Result<rust_decimal::Decimal> {
    let value:rust_decimal::Decimal=sqlx::query_scalar("select coalesce(sum(h.quantity * case i.kind when 'cash' then 1 else 12 end * case i.currency when 'USD' then 0.9 when 'GBP' then 1.2 else 1 end),0) from holding h join instrument i on i.id=h.instrument_id join account a on a.id=h.account_id join connection c on c.id=a.connection_id where c.user_id=$1 and ($2::uuid is null or a.id=$2)").bind(f.user_id).bind(account).fetch_one(pool).await?;
    let reporting = match f.config.reporting_currency.as_str() {
        "USD" => rust_decimal::Decimal::new(9, 1),
        "GBP" => rust_decimal::Decimal::new(12, 1),
        _ => rust_decimal::Decimal::ONE,
    };
    Ok(value / reporting)
}
pub fn decimal(value: &Value) -> anyhow::Result<rust_decimal::Decimal> {
    Ok(value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
        .parse()?)
}
