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
    let handshake = json!({"origin":server.url(),"token":server.token(),"anchor":f.config.anchor,"samples":config.samples,"warmups":config.warmups,"target":case,"expected":{"netWorth":net_worth.to_f64().unwrap()/reporting,"holding":f.holding_id,"holdingCount":count,"accountCount":f.config.accounts}});
    let mut child=tokio::process::Command::new("bun").arg("bench/runner.ts").current_dir(frontend_dir()).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).kill_on_drop(true).spawn().map_err(|_|anyhow::anyhow!("browser suite requires Bun, pinned Playwright and Chromium (bun x playwright install chromium)"))?;
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(&serde_json::to_vec(&handshake)?).await?;
    drop(stdin);
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(((config.samples + config.warmups + 1) * 90 + 30) as u64),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("browser child timed out"))??;
    server.shutdown().await?;
    let text = String::from_utf8(output.stdout)?;
    anyhow::ensure!(
        !text.contains(handshake["token"].as_str().unwrap()),
        "browser child leaked session token"
    );
    let result: Measurement = serde_json::from_str(&text)
        .map_err(|_| anyhow::anyhow!("browser child returned invalid measurement"))?;
    validate(case, &result, config.samples)?;
    anyhow::ensure!(
        output.status.success() == result.correct,
        "browser child status disagrees with correctness"
    );
    let reset = m.reset_ms;
    *m = result;
    m.reset_ms = reset;
    anyhow::ensure!(m.correct, "{}", m.errors.join("; "));
    Ok(())
}
