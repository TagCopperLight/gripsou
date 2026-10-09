//! Drains the layer's channel into the `log` table. Never logs through
//! tracing (that would feed its own queue); its own trouble goes to stderr.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tokio::sync::{mpsc, oneshot};

use super::LogLine;

const BATCH: usize = 200;
const TICK: Duration = Duration::from_secs(1);

pub struct LogWriter {
    pub(super) rx: mpsc::Receiver<LogLine>,
    pub(super) dropped: Arc<AtomicU64>,
}

pub struct WriterHandle {
    stop: oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

impl LogWriter {
    /// Write everything queued right now, in batches. A batch that fails to
    /// insert is dropped and counted; the next written batch reports the
    /// count as a `log lines dropped` warn line. Returns rows written.
    pub async fn flush(&mut self, db: &sqlx::PgPool) -> u64 {
        let mut written = 0;
        loop {
            let mut batch = Vec::with_capacity(BATCH + 1);
            let dropped = self.dropped.swap(0, Ordering::Relaxed);
            if dropped > 0 {
                batch.push(dropped_line(dropped));
            }
            while batch.len() < BATCH {
                match self.rx.try_recv() {
                    Ok(l) => batch.push(l),
                    Err(_) => break,
                }
            }
            if batch.is_empty() {
                return written;
            }
            let full = batch.len() >= BATCH;
            match crate::repo::log::insert_batch(db, &batch).await {
                Ok(n) => written += n,
                Err(e) => {
                    eprintln!(
                        "log writer: insert failed, {} line(s) dropped: {e}",
                        batch.len()
                    );
                    // The dropped-count line itself was part of the batch.
                    let lost = batch.len() as u64 - u64::from(dropped > 0) + dropped;
                    self.dropped.fetch_add(lost, Ordering::Relaxed);
                    return written;
                }
            }
            if !full {
                return written;
            }
        }
    }

    /// Run the writer in the background: flush every second until shut down.
    pub fn spawn(mut self, db: sqlx::PgPool) -> WriterHandle {
        let (stop, mut stopped) = oneshot::channel();
        let task = tokio::spawn(async move {
            let mut tick = tokio::time::interval(TICK);
            loop {
                tokio::select! {
                    _ = &mut stopped => {
                        self.flush(&db).await;
                        return;
                    }
                    _ = tick.tick() => {
                        self.flush(&db).await;
                    }
                }
            }
        });
        WriterHandle { stop, task }
    }
}

impl WriterHandle {
    /// Stop the loop after one last flush (best effort, on graceful shutdown).
    pub async fn shutdown(self) {
        let _ = self.stop.send(());
        let _ = self.task.await;
    }
}

fn dropped_line(count: u64) -> LogLine {
    LogLine {
        at: chrono::Utc::now(),
        level: "warn",
        target: "gripsou_core::logs".into(),
        message: "log lines dropped".into(),
        fields: serde_json::json!({ "count": count }),
    }
}
