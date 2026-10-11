use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tracing::instrument::WithSubscriber;
use tracing::{Event, Subscriber};
use tracing_subscriber::{
    Layer,
    layer::{Context, SubscriberExt},
};
struct Count(Arc<AtomicUsize>);
impl<S: Subscriber> Layer<S> for Count {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        if event.metadata().target() == "sqlx::query" {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }
}
/// A private subscriber scoped to this future; never changes production globals.
pub async fn count<F: std::future::Future>(future: F) -> (F::Output, usize) {
    let count = Arc::new(AtomicUsize::new(0));
    let subscriber = tracing_subscriber::registry().with(Count(count.clone()));
    let output = future.with_subscriber(subscriber).await;
    (output, count.load(Ordering::Relaxed))
}
pub fn memory() -> Value {
    let read = || -> Option<(u64, u64)> {
        let s = std::fs::read_to_string("/proc/self/status").ok()?;
        let field = |name: &str| {
            s.lines()
                .find(|l| l.starts_with(name))?
                .split_whitespace()
                .nth(1)?
                .parse::<u64>()
                .ok()
                .map(|n| n * 1024)
        };
        Some((field("VmRSS:")?, field("VmHWM:")?))
    };
    let rss = read();
    json!({"scope":"Rust benchmark/application process only; excludes PostgreSQL and Chromium","method":"Linux /proc/self/status point observation after separate diagnostic operation","rss_bytes":rss.map(|r|r.0),"peak_rss_bytes":rss.map(|r|r.1),"reason":if rss.is_none(){Some("process RSS unavailable on this platform")}else{None}})
}
pub async fn collect(
    case: &crate::catalog::Case,
    scratch: &mut crate::database::ScratchRun,
    template: &str,
    f: &crate::fixture::Fixture,
) -> anyhow::Result<Value> {
    let (name, pool) = scratch.create_db(Some(template)).await?;
    let result=async{
  if case.suite!="backend"{return Ok(json!({"sql_count":null,"plan":null,"reason":"separate SQL diagnostics currently support internal backend calls only","memory":memory()}));}
  let prepared=crate::operations::prepare(case,&pool,f).await?;
  let (execution,n)=count(crate::operations::execute(&prepared,&pool)).await;let execution=execution?;crate::operations::verify(&prepared,&pool,&execution).await?;
  // Explicitly equivalent to holding_prices: same joins, ownership and bounds.
  let plan=if case.id.starts_with("prices.history"){
   let from=if case.id.ends_with("short"){f.today()-chrono::Duration::days(30)}else{f.from()};
   let statement="explain (analyze,buffers,format json) select p.ts,p.unit_price from holding h join account a on a.id=h.account_id join connection c on c.id=a.connection_id join price p on p.instrument_id=h.instrument_id where h.id=$1 and c.user_id=$2 and p.ts between $3 and $4 order by p.ts";
   let plan:Value=sqlx::query_scalar(statement).bind(f.holding_id).bind(f.user_id).bind(from.and_hms_opt(0,0,0).unwrap().and_utc()).bind(f.today().and_hms_opt(23,59,59).unwrap().and_utc()).fetch_one(&pool).await?;json!({"method":"EXPLAIN ANALYZE BUFFERS FORMAT JSON on separate reset clone","statement":statement,"plan":plan})
  }else{json!({"plan":null,"reason":"no registered equivalent diagnostic SQL"})};
  Ok::<_,anyhow::Error>(json!({"sql_count":if n>0{Some(n)}else{None},"sql_count_reason":if n==0{Some("operation emitted no supported sqlx::query events (pure call or unsupported source)")}else{None},"memory":memory(),"explain":plan,"scope":"separate reset clone; preparation and verification excluded from SQL count"}))
 }.await;
    scratch.remove_db(&name).await?;
    result
}
