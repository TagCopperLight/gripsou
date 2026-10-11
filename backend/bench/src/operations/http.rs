use super::*;
use crate::server::ServerHandle;
use anyhow::ensure;
pub fn path(id: &str, f: &Fixture) -> anyhow::Result<String> {
    Ok(match id {
        "http.net-worth" => "/dashboard/net-worth?range=all".into(),
        "http.distribution" => "/dashboard/distribution".into(),
        "http.accounts" => "/accounts".into(),
        "http.holdings" => "/holdings".into(),
        "http.returns" => "/investments/returns".into(),
        "http.prices" => format!("/holdings/{}/prices?range=all", f.holding_id),
        "http.transactions" => "/transactions?limit=200&include_transfers=true".into(),
        "http.transaction-counts" => "/transactions/counts?include_transfers=true".into(),
        "http.budget-summary" => format!("/budget/summary?month={}", &f.config.anchor[..7]),
        "http.budget-trend" => format!("/budget/trend?anchor={}&months=12", &f.config.anchor[..7]),
        "http.lot-preview" => format!("/holdings/{}/lots/preview", f.holding_id),
        "http.lot-suggestions" => format!("/holdings/{}/lots/suggestions", f.holding_id),
        _ => anyhow::bail!("unknown HTTP case"),
    })
}
pub async fn execute(
    id: &str,
    f: &Fixture,
    server: &ServerHandle,
    client: &reqwest::Client,
) -> anyhow::Result<Execution> {
    let url = format!("{}/api{}", server.url(), path(id, f)?);
    let mut request = if id == "http.lot-preview" {
        client.post(url).json(&serde_json::json!({"rows":[{"type":"buy","date":f.from().to_string(),"quantity":"100","unitPrice":"12","fee":"1"}]}))
    } else {
        client.get(url)
    };
    request = request.bearer_auth(server.token());
    let start = std::time::Instant::now();
    let response = request.send().await?;
    let status = response.status();
    let bytes = response.bytes().await?;
    let elapsed = start.elapsed();
    ensure!(status.is_success(), "HTTP status {status}");
    let body: Value = serde_json::from_slice(&bytes)?;
    let rows = body.as_array().map_or(1, Vec::len);
    Ok(Execution {
        elapsed,
        rows,
        outcome: serde_json::json!({"body":body,"decoded_body_bytes":bytes.len()}),
        batch_size: 1,
    })
}
pub async fn verify(
    id: &str,
    f: &Fixture,
    pool: &sqlx::PgPool,
    e: &Execution,
) -> anyhow::Result<()> {
    let body = &e.outcome["body"];
    match id {
        "http.holdings" => {
            let mut rows = body.clone();
            for row in rows
                .as_array_mut()
                .ok_or_else(|| anyhow::anyhow!("holdings not array"))?
            {
                row["holding_id"] = row["id"].clone();
                row["quantity"] = row["qty"].clone();
                row["mean_price"] = row["meanPrice"].clone();
                row["unexplained_quantity"] = row["unexplainedQty"].clone();
            }
            let case = crate::catalog::catalog()
                .into_iter()
                .find(|c| c.id == "portfolio.holdings")
                .unwrap();
            let p = prepare(&case, pool, f).await?;
            super::verify(
                &p,
                pool,
                &Execution {
                    elapsed: e.elapsed,
                    rows: e.rows,
                    outcome: rows,
                    batch_size: 1,
                },
            )
            .await?;
        }
        "http.transactions" => {
            let case = crate::catalog::catalog()
                .into_iter()
                .find(|c| c.id == "transactions.page.first")
                .unwrap();
            let mut p = prepare(&case, pool, f).await?;
            p.filters.include_transfers = true;
            let mut rows = body.clone();
            for row in rows
                .as_array_mut()
                .ok_or_else(|| anyhow::anyhow!("transactions not array"))?
            {
                row["ts"] = serde_json::json!(
                    chrono::DateTime::from_timestamp_millis(
                        row["t"]
                            .as_i64()
                            .ok_or_else(|| anyhow::anyhow!("missing t"))?
                    )
                    .unwrap()
                );
            }
            transactions::verify(&p, pool, &rows).await?;
        }
        "http.accounts" | "http.distribution" => {
            ensure!(
                body.as_array().map(Vec::len) == Some(f.config.accounts),
                "wrong account count"
            );
            for row in body.as_array().unwrap() {
                let id: uuid::Uuid = serde_json::from_value(row["id"].clone())?;
                ensure!(
                    (0..f.config.accounts).any(|n| id == crate::fixture::id(3, 0, n)),
                    "foreign HTTP account"
                );
                ensure!(
                    decimal(&row["value"])? == super::fixture_value(pool, f, Some(id)).await?,
                    "wrong HTTP account value"
                );
            }
        }
        "http.net-worth" => {
            let points = body["points"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("missing points"))?;
            ensure!(!points.is_empty(), "empty net worth");
            ensure!(
                decimal(&points.last().unwrap()["netWorth"])?
                    == super::fixture_value(pool, f, None).await?,
                "wrong HTTP net worth amount"
            );
            ensure!(
                points.last().unwrap()["t"]
                    == serde_json::json!(
                        f.today()
                            .and_hms_opt(0, 0, 0)
                            .unwrap()
                            .and_utc()
                            .timestamp_millis()
                    ),
                "wrong net worth axis"
            );
        }
        "http.returns" => ensure!(
            body["today"] == serde_json::json!(f.today()),
            "wrong returns date"
        ),
        "http.prices" => {
            ensure!(!body.as_array().unwrap().is_empty(), "empty prices");
            for point in body.as_array().unwrap() {
                ensure!(
                    decimal(&point["price"])? == rust_decimal::Decimal::from(12),
                    "wrong HTTP price"
                );
            }
        }
        "http.budget-trend" => ensure!(
            body["months"].as_array().map(Vec::len) == Some(12),
            "wrong trend axis"
        ),
        "http.budget-summary" => {
            let expected = super::budget::expected_figures(
                pool,
                f,
                gripsou_core::budget::overview::Month::containing(f.today()),
            )
            .await?;
            ensure!(
                decimal(&body["figures"]["income"]["amount"])? == expected.income
                    && decimal(&body["figures"]["expenses"]["amount"])? == expected.expenses
                    && decimal(&body["figures"]["net"]["amount"])? == expected.net,
                "wrong HTTP budget figures"
            );
        }
        "http.lot-preview" => ensure!(
            decimal(&body["meanPrice"])? == rust_decimal::Decimal::new(1201, 2),
            "wrong HTTP preview"
        ),
        "http.lot-suggestions" => ensure!(
            body.as_array().is_some_and(Vec::is_empty),
            "fixture must not suggest invented lots"
        ),
        "http.transaction-counts" => ensure!(
            body["total"].as_i64().unwrap_or(0) > 0,
            "missing transaction counts"
        ),
        _ => anyhow::bail!("HTTP oracle missing"),
    }
    Ok(())
}
