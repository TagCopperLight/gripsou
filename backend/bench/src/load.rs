use crate::{
    catalog::Case, config::RunConfig, fixture::Fixture, report::Measurement, server::ServerHandle,
};
use serde_json::json;
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::{Barrier, Semaphore};
#[derive(Debug, serde::Serialize)]
pub struct Traffic {
    #[serde(skip)]
    pub start: Instant,
    pub offered: usize,
    pub success: usize,
    pub failed: usize,
    pub timeouts: usize,
    pub rejected: usize,
    pub peak: usize,
    pub latencies: Vec<f64>,
    pub requests: Vec<Request>,
    pub wall_ms: f64,
}
#[derive(Debug, serde::Serialize)]
pub struct Request {
    pub index: usize,
    pub scheduled_ms: f64,
    pub submitted_ms: Option<f64>,
    pub completed_ms: f64,
    pub status: String,
}
async fn traffic<F, Fut>(
    n: usize,
    concurrency: usize,
    interval: Option<Duration>,
    operation: F,
) -> Traffic
where
    F: Fn(usize) -> Fut + Clone + Send + 'static,
    Fut: std::future::Future<Output = anyhow::Result<()>> + Send + 'static,
{
    let start = Instant::now();
    let gate = Arc::new(Barrier::new(if interval.is_some() { 1 } else { n + 1 }));
    let capacity = Arc::new(Semaphore::new(concurrency));
    let queue = Arc::new(Semaphore::new(concurrency * 2));
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let mut jobs = tokio::task::JoinSet::new();
    let mut rejected = vec![];
    for i in 0..n {
        let scheduled = if let Some(interval) = interval {
            let when = start + interval * i as u32;
            tokio::time::sleep_until(when.into()).await;
            when
        } else {
            start
        };
        let ticket = if interval.is_some() {
            match queue.clone().try_acquire_owned() {
                Ok(ticket) => Some(ticket),
                Err(_) => {
                    rejected.push(Request {
                        index: i,
                        scheduled_ms: scheduled.duration_since(start).as_secs_f64() * 1000.,
                        submitted_ms: None,
                        completed_ms: Instant::now().duration_since(start).as_secs_f64() * 1000.,
                        status: "rejected".into(),
                    });
                    continue;
                }
            }
        } else {
            None
        };
        let (gate, capacity, active, peak, op) = (
            gate.clone(),
            capacity.clone(),
            active.clone(),
            peak.clone(),
            operation.clone(),
        );
        jobs.spawn(async move {
            let _ticket = ticket;
            gate.wait().await;
            let _permit = capacity.acquire_owned().await.unwrap();
            let submitted = Instant::now();
            let current = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(current, Ordering::SeqCst);
            let result = tokio::time::timeout(Duration::from_secs(120), op(i)).await;
            active.fetch_sub(1, Ordering::SeqCst);
            let completed = Instant::now();
            let status = match result {
                Ok(Ok(())) => "success",
                Ok(Err(_)) => "error",
                Err(_) => "timeout",
            };
            (
                completed.duration_since(scheduled).as_secs_f64() * 1000.,
                Request {
                    index: i,
                    scheduled_ms: scheduled.duration_since(start).as_secs_f64() * 1000.,
                    submitted_ms: Some(submitted.duration_since(start).as_secs_f64() * 1000.),
                    completed_ms: completed.duration_since(start).as_secs_f64() * 1000.,
                    status: status.into(),
                },
            )
        });
    }
    if interval.is_none() {
        gate.wait().await;
    }
    let rejected_count = rejected.len();
    let mut rows = rejected;
    let mut latencies = vec![];
    while let Some(job) = jobs.join_next().await {
        match job {
            Ok((latency, row)) => {
                latencies.push(latency);
                rows.push(row);
            }
            Err(_) => {
                rows.push(Request {
                    index: usize::MAX,
                    scheduled_ms: 0.,
                    submitted_ms: None,
                    completed_ms: start.elapsed().as_secs_f64() * 1000.,
                    status: "panic".into(),
                });
                latencies.push(start.elapsed().as_secs_f64() * 1000.);
            }
        }
    }
    for row in rows.iter().filter(|r| r.status == "rejected") {
        latencies.push(row.completed_ms - row.scheduled_ms);
    }
    let success = rows.iter().filter(|r| r.status == "success").count();
    let timeouts = rows.iter().filter(|r| r.status == "timeout").count();
    rows.sort_by_key(|r| r.index);
    Traffic {
        start,
        offered: n,
        success,
        failed: n - success,
        timeouts,
        rejected: rejected_count,
        peak: peak.load(Ordering::SeqCst),
        latencies,
        requests: rows,
        wall_ms: start.elapsed().as_secs_f64() * 1000.,
    }
}
pub async fn controlled_test(n: usize, concurrency: usize, fail: Option<usize>) -> Traffic {
    traffic(n, concurrency, None, move |i| async move {
        tokio::time::sleep(Duration::from_millis(10)).await;
        anyhow::ensure!(Some(i) != fail, "controlled 500");
        Ok(())
    })
    .await
}
async fn scenario(
    config: &RunConfig,
    case: &Case,
    f: &Fixture,
    pool: &sqlx::PgPool,
) -> anyhow::Result<(Traffic, f64)> {
    let server = Arc::new(
        ServerHandle::start(
            pool,
            f.user_id,
            &crate::browser::frontend_dir().join("dist"),
        )
        .await?,
    );
    let client = reqwest::Client::new();
    let bg_needed = case.id.contains("during") || case.id.contains("ingest.");
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut background = tokio::task::JoinSet::new();
    if bg_needed {
        let pool = pool.clone();
        let fixture = f.clone();
        let id = case.id.clone();
        background.spawn(async move {
            let begin = Instant::now();
            let _ = tx.send(begin);
            if id.contains("backfill") {
                let mut conn = pool.acquire().await?;
                gripsou_core::backfill::backfill_connection(&mut conn, fixture.syncs[0].0).await?;
            } else {
                gripsou_core::ingest::ingest(&pool, fixture.syncs[0].0, &fixture.syncs[0].1)
                    .await?;
            }
            Ok::<_, anyhow::Error>((begin, Instant::now()))
        });
    } else {
        drop(tx);
    }
    let bg_start = if bg_needed { Some(rx.await?) } else { None };
    let (s, client, pool, f, id) = (
        server.clone(),
        client.clone(),
        pool.clone(),
        f.clone(),
        case.id.clone(),
    );
    let interval = if case.id.ends_with("fixed-duration") {
        Some(Duration::from_millis(100))
    } else {
        None
    };
    let concurrency = if case.id == "load.pool-saturation" {
        20
    } else {
        config.concurrency
    };
    let traffic = traffic(100, concurrency, interval, move |i| {
        let (s, client, pool, f, id) = (
            s.clone(),
            client.clone(),
            pool.clone(),
            f.clone(),
            id.clone(),
        );
        async move {
            if id == "load.ingest.same-user" {
                gripsou_core::ingest::ingest(&pool, f.syncs[1].0, &f.syncs[1].1).await?;
            } else if id == "load.ingest.different-users" {
                let conn = crate::fixture::id(2, 1, 0);
                let mut sync = f.syncs[0].1.clone();
                sync.transactions.clear();
                gripsou_core::ingest::ingest(&pool, conn, &sync).await?;
            } else if id == "load.bulk-during-ingest" {
                let ids = (100..120)
                    .map(|n| crate::fixture::id(7, 0, n))
                    .collect::<Vec<_>>();
                let outcome = gripsou_core::repo::budget::assign::bulk_apply(
                    &pool,
                    f.user_id,
                    &ids,
                    gripsou_core::repo::budget::assign::BulkChanges {
                        checked: Some(true),
                        ..Default::default()
                    },
                    true,
                )
                .await?;
                anyhow::ensure!(
                    matches!(
                        outcome,
                        gripsou_core::repo::budget::assign::WriteOutcome::Done(20)
                    ),
                    "bulk load write failed"
                );
            } else {
                let target = if id.contains("transactions") {
                    "http.transactions"
                } else {
                    [
                        "http.net-worth",
                        "http.transactions",
                        "http.accounts",
                        "http.holdings",
                    ][i % 4]
                };
                let e = crate::operations::http::execute(target, &f, &s, &client).await?;
                crate::operations::http::verify(target, &f, &pool, &e).await?;
            }
            Ok(())
        }
    })
    .await;
    let mut bg_ms = 0.;
    if bg_needed {
        let (begin, end) = background.join_next().await.unwrap()??;
        bg_ms = end.duration_since(begin).as_secs_f64() * 1000.;
        let earliest = traffic
            .requests
            .iter()
            .filter_map(|r| r.submitted_ms)
            .fold(f64::INFINITY, f64::min);
        let first = traffic.start + Duration::from_secs_f64(earliest / 1000.);
        anyhow::ensure!(
            first >= bg_start.unwrap() && first < end,
            "background and foreground did not overlap"
        );
    }
    drop(server);
    anyhow::ensure!(
        traffic.offered == traffic.success + traffic.failed && traffic.latencies.len() == 100,
        "load accounting mismatch"
    );
    Ok((traffic, bg_ms))
}
pub async fn measure(
    config: &RunConfig,
    case: &Case,
    scratch: &mut crate::database::ScratchRun,
    template: &str,
    f: &Fixture,
    m: &mut Measurement,
) -> anyhow::Result<()> {
    let mut stats = vec![];
    let mut bg = vec![];
    m.parameters = json!({"requests_per_trial":100,"concurrency":if case.id=="load.pool-saturation"{20}else{config.concurrency},"offer_rate":if case.id.ends_with("fixed-duration"){Some(10)}else{None},"duration_seconds":if case.id.ends_with("fixed-duration"){Some(10)}else{None},"queue_capacity":config.concurrency*2,"scheduling":"all fixed-work requests scheduled at release; fixed-duration offers independent of completions"});
    for trial in 0..1 + config.warmups + config.samples {
        let t = Instant::now();
        let (name, pool) = scratch.create_db(Some(template)).await?;
        m.reset_ms += t.elapsed().as_secs_f64() * 1000.;
        let result =
            tokio::time::timeout(Duration::from_secs(120), scenario(config, case, f, &pool)).await;
        scratch.remove_db(&name).await?;
        let (traffic, background) =
            result.map_err(|_| anyhow::anyhow!("load scenario exceeded 120 seconds"))??;
        let failed = traffic.failed;
        if failed > 0 {
            m.diagnostics.insert("failed_trial".into(), json!(traffic));
        }
        if trial == 0 {
            m.first_ms = Some(crate::report::statistics(&traffic.latencies)?.1);
            m.diagnostics
                .insert("background_first_ms".into(), json!(background));
            m.outcome = json!({"offered":traffic.offered,"success":traffic.success,"failed":traffic.failed,"fixture":crate::report::fingerprint(&f.config)?});
            m.rows = traffic.success;
        } else if trial > config.warmups {
            m.samples_ms.extend(&traffic.latencies);
            bg.push(background);
            stats.push(traffic);
        }
        if failed > 0 {
            m.diagnostics.insert("requests".into(), json!(stats));
            anyhow::bail!(
                "load had {failed} unsuccessful requests; retained failed_trial accounting"
            );
        }
    }
    m.diagnostics.insert("requests".into(), json!(stats));
    m.diagnostics
        .insert("background_samples_ms".into(), json!(bg));
    m.diagnostics.insert("sample_unit".into(),json!("scheduled-to-completed request, including client and pool queueing plus correctness validation"));
    Ok(())
}
