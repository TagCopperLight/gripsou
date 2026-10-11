use crate::{
    catalog::Case, config::RunConfig, fixture::Fixture, report::Measurement, server::ServerHandle,
};
use serde_json::json;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
pub fn frontend_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../frontend")
}
pub async fn build() -> anyhow::Result<String> {
    let output = tokio::process::Command::new("bun")
        .args(["run", "build"])
        .current_dir(frontend_dir())
        .output()
        .await
        .map_err(|_| {
            anyhow::anyhow!("browser suite requires Bun and installed frontend dependencies")
        })?;
    anyhow::ensure!(output.status.success(), "production frontend build failed");
    let mut files = vec![];
    fn visit(dir: &Path, files: &mut Vec<PathBuf>) -> anyhow::Result<()> {
        for e in std::fs::read_dir(dir)? {
            let p = e?.path();
            if p.is_dir() {
                visit(&p, files)?;
            } else {
                files.push(p);
            }
        }
        Ok(())
    }
    let dist = frontend_dir().join("dist");
    visit(&dist, &mut files)?;
    files.sort();
    let mut data = vec![];
    for p in files {
        data.extend_from_slice(p.strip_prefix(&dist)?.to_string_lossy().as_bytes());
        data.extend(std::fs::read(p)?);
    }
    crate::report::fingerprint(&data)
}
pub fn validate(case: &Case, m: &Measurement, samples: usize) -> anyhow::Result<()> {
    anyhow::ensure!(
        m.id == case.id
            && m.boundary == case.boundary
            && m.reset == case.reset
            && m.batch_size == 1,
        "browser child changed measurement contract"
    );
    anyhow::ensure!(
        (!m.correct || m.first_ms.is_some()) && m.samples_ms.len() <= samples,
        "browser child invalid trial count"
    );
    if m.correct {
        anyhow::ensure!(
            m.samples_ms.len() == samples && m.errors.is_empty() && m.outcome.is_object(),
            "invalid successful browser measurement"
        );
    }
    for n in m.first_ms.iter().chain(&m.samples_ms) {
        anyhow::ensure!(n.is_finite() && *n >= 0., "invalid browser duration");
    }
    Ok(())
}
pub async fn measure(
    config: &RunConfig,
    case: &Case,
    f: &Fixture,
    pool: &sqlx::PgPool,
    m: &mut Measurement,
) -> anyhow::Result<()> {
    if case.id == "browser.lots.open" {
        sqlx::query("update holding set quantity=quantity+1 where id=$1")
            .bind(f.holding_id)
            .execute(pool)
            .await?;
        sqlx::query("update holding_snapshot set quantity=quantity+1,value=value+12 where holding_id=$1 and as_of=$2").bind(f.holding_id).bind(f.today()).execute(pool).await?;
    }
    let net_worth:rust_decimal::Decimal=sqlx::query_scalar("select sum(h.quantity*case i.kind when 'cash' then 1 else 12 end*case i.currency when 'USD' then 0.9 when 'GBP' then 1.2 else 1 end) from holding h join instrument i on i.id=h.instrument_id join account a on a.id=h.account_id join connection c on c.id=a.connection_id where c.user_id=$1").bind(f.user_id).fetch_one(pool).await?;
    use rust_decimal::prelude::ToPrimitive;
    let reporting = match f.config.reporting_currency.as_str() {
        "USD" => 0.9,
        "GBP" => 1.2,
        _ => 1.,
    };
    let count:i64=sqlx::query_scalar("select count(*) from holding h join account a on a.id=h.account_id join connection c on c.id=a.connection_id where c.user_id=$1 and h.quantity<>0").bind(f.user_id).fetch_one(pool).await?;
    let server = ServerHandle::start(pool, f.user_id, &frontend_dir().join("dist")).await?;
    let handshake = json!({"origin":server.url(),"token":server.token(),"anchor":f.config.anchor,"samples":config.samples,"warmups":config.warmups,"target":case,"expected":{"netWorth":net_worth.to_f64().unwrap()/reporting,"holding":f.holding_id,"holdingCount":count,"accountCount":f.config.accounts,"lotCount":f.config.lots_per_security}});
    let mut command = tokio::process::Command::new("bun");
    command.arg("bench/runner.ts").current_dir(frontend_dir());
    let child_result = child_output(
        command,
        &handshake,
        std::time::Duration::from_secs(((config.samples + config.warmups + 1) * 90 + 30) as u64),
    )
    .await;
    // Stop the listener before returning a child failure to scratch cleanup.
    server.shutdown().await?;
    let result = decode_output(
        case,
        child_result?,
        config.samples,
        handshake["token"].as_str().unwrap(),
    )?;
    let reset = m.reset_ms;
    *m = result;
    m.reset_ms = reset;
    if m.correct {
        verify_observed(pool, f, &m.outcome).await?;
    }
    anyhow::ensure!(m.correct, "{}", m.errors.join("; "));
    Ok(())
}

// Re-check captured application responses against persisted fixture inputs.
// Child expectations are never accepted as evidence of correctness.
pub async fn verify_observed(
    pool: &sqlx::PgPool,
    f: &Fixture,
    outcome: &serde_json::Value,
) -> anyhow::Result<()> {
    use crate::operations::{self, Execution};
    let api = outcome["api"]
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("missing observed browser responses"))?;
    anyhow::ensure!(!api.is_empty(), "no browser semantic observations");
    for (path, body) in api {
        let url = url::Url::parse(&format!("http://fixture{path}"))?;
        let route = url.path().strip_prefix("/api").unwrap_or(url.path());
        let query: std::collections::BTreeMap<_, _> = url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        let e = Execution {
            elapsed: std::time::Duration::ZERO,
            rows: body.as_array().map_or(1, Vec::len),
            outcome: serde_json::json!({"body":body}),
            batch_size: 1,
        };
        let id = match route {
            "/dashboard/net-worth" => Some("http.net-worth"),
            "/dashboard/distribution" => Some("http.distribution"),
            "/accounts" => Some("http.accounts"),
            "/holdings" => Some("http.holdings"),
            "/investments/returns" => Some("http.returns"),
            "/budget/summary" => Some("http.budget-summary"),
            "/budget/trend" => Some("http.budget-trend"),
            "/transactions/counts" => Some("http.transaction-counts"),
            _ if route.ends_with("/lots/suggestions") => Some("http.lot-suggestions"),
            _ if route.ends_with("/prices") => Some("http.prices"),
            _ => None,
        };
        if let Some(id) = id {
            operations::http::verify(id, f, pool, &e).await?;
            continue;
        }
        match route {
            "/transactions" => {
                let case = crate::catalog::catalog()
                    .into_iter()
                    .find(|c| c.id == "transactions.page.first")
                    .unwrap();
                let mut prepared = operations::prepare(&case, pool, f).await?;
                prepared.filters.search = query.get("search").cloned();
                prepared.filters.account_id =
                    query.get("accountId").map(|v| v.parse()).transpose()?;
                prepared.filters.offset = query
                    .get("offset")
                    .map(|v| v.parse())
                    .transpose()?
                    .unwrap_or(0);
                prepared.filters.limit = query
                    .get("limit")
                    .map(|v| v.parse())
                    .transpose()?
                    .unwrap_or(200);
                let mut rows = body.clone();
                for row in rows
                    .as_array_mut()
                    .ok_or_else(|| anyhow::anyhow!("missing browser transactions"))?
                {
                    row["ts"] = serde_json::json!(
                        chrono::DateTime::from_timestamp_millis(
                            row["t"]
                                .as_i64()
                                .ok_or_else(|| anyhow::anyhow!("missing transaction date"))?
                        )
                        .ok_or_else(|| anyhow::anyhow!("invalid transaction date"))?
                    );
                }
                operations::verify(&prepared, pool, &Execution { outcome: rows, ..e }).await?;
            }
            "/accounts/series" => {
                let points = body["points"]
                    .as_array()
                    .ok_or_else(|| anyhow::anyhow!("missing account chart"))?;
                let last = points
                    .last()
                    .ok_or_else(|| anyhow::anyhow!("empty account chart"))?;
                anyhow::ensure!(
                    last["values"].as_object().map(serde_json::Map::len) == Some(f.config.accounts),
                    "wrong chart accounts"
                );
                for n in 0..f.config.accounts {
                    let id = crate::fixture::id(3, 0, n);
                    anyhow::ensure!(
                        operations::decimal(&last["values"][id.to_string()])?
                            == operations::fixture_value(pool, f, Some(id)).await?,
                        "wrong account chart value"
                    );
                }
            }
            _ if route.ends_with("/lots/preview") => {
                let pairs = rust_decimal::Decimal::from(f.config.lots_per_security / 2);
                anyhow::ensure!(
                    operations::decimal(&body["meanPrice"])? == rust_decimal::Decimal::new(1201, 2)
                        && operations::decimal(&body["invested"])?
                            == rust_decimal::Decimal::from(1080) * pairs
                        && operations::decimal(&body["realised"])?
                            == rust_decimal::Decimal::new(-11, 1) * pairs
                        && operations::decimal(&body["unrealised"])? == rust_decimal::Decimal::ZERO,
                    "wrong observed lot preview"
                );
            }
            _ if route.ends_with("/lots") => {
                let holding: uuid::Uuid = route
                    .split('/')
                    .nth(2)
                    .ok_or_else(|| anyhow::anyhow!("missing lot holding"))?
                    .parse()?;
                let expected:Vec<(uuid::Uuid,chrono::NaiveDate,rust_decimal::Decimal,rust_decimal::Decimal,rust_decimal::Decimal)>=sqlx::query_as("select l.id,l.acquired_on,l.quantity,l.unit_price,l.fee from lot l join holding h on h.id=l.holding_id join account a on a.id=h.account_id join connection c on c.id=a.connection_id where c.user_id=$1 and h.id=$2").bind(f.user_id).bind(holding).fetch_all(pool).await?;
                let rows = body
                    .as_array()
                    .ok_or_else(|| anyhow::anyhow!("missing lots"))?;
                anyhow::ensure!(rows.len() == expected.len(), "wrong browser lot coverage");
                for (id, date, qty, price, fee) in expected {
                    let row = rows
                        .iter()
                        .find(|r| r["id"] == serde_json::json!(id))
                        .ok_or_else(|| anyhow::anyhow!("foreign lot"))?;
                    anyhow::ensure!(
                        row["t"]
                            == serde_json::json!(
                                date.and_hms_opt(0, 0, 0)
                                    .unwrap()
                                    .and_utc()
                                    .timestamp_millis()
                            )
                            && operations::decimal(&row["qty"])? == qty
                            && operations::decimal(&row["price"])? == price
                            && operations::decimal(&row["fee"])? == fee,
                        "wrong browser lot value"
                    );
                }
            }
            _ => anyhow::bail!("browser endpoint has no oracle: {route}"),
        }
    }
    Ok(())
}

async fn child_output(
    mut command: tokio::process::Command,
    handshake: &serde_json::Value,
    timeout: std::time::Duration,
) -> anyhow::Result<std::process::Output> {
    let mut child=command.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).kill_on_drop(true).spawn().map_err(|_|anyhow::anyhow!("browser suite requires Bun, pinned Playwright and Chromium (bun x playwright install chromium)"))?;
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(&serde_json::to_vec(handshake)?).await?;
    drop(stdin);
    Ok(tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| anyhow::anyhow!("browser child timed out"))??)
}
fn decode_output(
    case: &Case,
    output: std::process::Output,
    samples: usize,
    token: &str,
) -> anyhow::Result<Measurement> {
    let text = String::from_utf8(output.stdout)?;
    anyhow::ensure!(!text.contains(token), "browser child leaked session token");
    let result: Measurement = serde_json::from_str(&text)
        .map_err(|_| anyhow::anyhow!("browser child returned invalid measurement"))?;
    validate(case, &result, samples)?;
    anyhow::ensure!(
        output.status.success() == result.correct,
        "browser child status disagrees with correctness"
    );
    Ok(result)
}
#[cfg(test)]
mod child_tests {
    use super::*;
    #[tokio::test]
    async fn absent_crashed_malformed_and_secret_leaking_children_fail_closed() -> anyhow::Result<()>
    {
        let case = crate::catalog::catalog()
            .into_iter()
            .find(|c| c.id == "browser.dashboard.ready")
            .unwrap();
        let token = "synthetic-private-test-token";
        let handshake = json!({"token":token});
        assert!(
            child_output(
                tokio::process::Command::new("/nonexistent/gripsou-browser"),
                &handshake,
                std::time::Duration::from_secs(1)
            )
            .await
            .is_err()
        );
        for script in [
            "cat >/dev/null; exit 7",
            "cat >/dev/null; echo malformed",
            "cat >/dev/null; echo synthetic-private-test-token",
        ] {
            let mut cmd = tokio::process::Command::new("bash");
            cmd.arg("-c").arg(script);
            let output = child_output(cmd, &handshake, std::time::Duration::from_secs(1)).await?;
            let error = decode_output(&case, output, 1, token)
                .unwrap_err()
                .to_string();
            assert!(!error.contains(token));
        }
        Ok(())
    }
    #[tokio::test]
    async fn timed_out_child_is_killed_and_listener_and_scratch_can_close() -> anyhow::Result<()> {
        let mut scratch = crate::database::ScratchRun::new(&std::env::var("DATABASE_URL")?).await?;
        let (_, pool) = scratch.create_db(None).await?;
        let f =
            crate::fixture::seed(&pool, &crate::config::FixtureConfig::profile("smoke")?).await?;
        let server =
            ServerHandle::start(&pool, f.user_id, std::path::Path::new("/nonexistent")).await?;
        let url = server.url().to_string();
        let marker =
            std::env::temp_dir().join(format!("gripsou-child-pid-{}", uuid::Uuid::new_v4()));
        let mut command = tokio::process::Command::new("bash");
        command
            .arg("-c")
            .arg("echo $$ > \"$1\"; cat >/dev/null; exec sleep 30")
            .arg("benchmark-child")
            .arg(&marker);
        let result = child_output(
            command,
            &json!({"token":"synthetic"}),
            std::time::Duration::from_millis(250),
        )
        .await;
        assert!(result.is_err());
        let pid = std::fs::read_to_string(&marker)?;
        std::fs::remove_file(marker)?;
        server.shutdown().await?;
        scratch.cleanup().await?;
        assert!(reqwest::get(format!("{url}/api/health")).await.is_err());
        for _ in 0..50 {
            if !std::path::Path::new(&format!("/proc/{}", pid.trim())).exists() {
                return Ok(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        anyhow::bail!("timed-out child process survived")
    }
}
