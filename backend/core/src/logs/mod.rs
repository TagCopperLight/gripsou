//! Logging support: the saved-log layer and writer, and helpers every log
//! site uses. Conventions (fixed messages, shared field names, levels) are in
//! CLAUDE.md "Logs".

mod layer;
mod writer;

pub use layer::{LogLayer, is_saved};
pub use writer::{LogWriter, WriterHandle};

/// Lines held in memory while the database is slow or down.
pub const QUEUE_CAPACITY: usize = 10_000;

/// Install the process-wide subscriber: the terminal, filtered by `terminal`
/// (RUST_LOG), and the saved log. Returns the writer to spawn once the
/// database is migrated.
///
/// Deliberately not `.init()`: that also installs the `log`-crate bridge, and
/// with per-layer filters the bridge's "is this enabled?" checks (sqlx asks on
/// every query) made tracing drop the next line from both outputs. Crates that
/// log through `log` (sqlx, reqwest, rustls) go unbridged; at info they are
/// silent anyway.
pub fn install(terminal: tracing_subscriber::EnvFilter) -> LogWriter {
    use tracing_subscriber::{Layer, layer::SubscriberExt};
    let (layer, writer) = channel(QUEUE_CAPACITY);
    let subscriber = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(terminal))
        .with(layer.filtered());
    tracing::subscriber::set_global_default(subscriber).expect("subscriber installed once");
    writer
}

/// The layer to install and the writer that drains it. Create both before the
/// pool exists, so startup lines are queued; spawn the writer once migrations
/// have run.
pub fn channel(capacity: usize) -> (LogLayer, LogWriter) {
    let (tx, rx) = tokio::sync::mpsc::channel(capacity);
    let dropped = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    (
        LogLayer {
            tx,
            dropped: dropped.clone(),
        },
        LogWriter { rx, dropped },
    )
}

/// How long saved log rows are kept. The daily sweep deletes older rows.
pub const RETENTION_DAYS: i32 = 90;

/// An error with its whole `source()` chain, `top: cause: cause`. reqwest's
/// own `Display` is "error sending request for url (…)" and leaves the reason
/// (timeout, DNS, TLS) in the chain, so a plain `{e}` loses it.
pub fn error_chain(e: &(dyn std::error::Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(c) = cur {
        let msg = c.to_string();
        // Some errors repeat their source in their own message; don't stutter.
        if !out.ends_with(&msg) {
            out.push_str(": ");
            out.push_str(&msg);
        }
        cur = c.source();
    }
    out
}

/// One saved log line, as queued by the layer and written by the writer.
#[derive(Debug, Clone)]
pub struct LogLine {
    pub at: chrono::DateTime<chrono::Utc>,
    /// `error` | `warn` | `info`.
    pub level: &'static str,
    pub target: String,
    pub message: String,
    /// A JSON object: event fields over span fields, plus `spans`.
    pub fields: serde_json::Value,
}

/// Test helper (public because `cfg(test)` does not cross crates): install the
/// saving layer as this thread's subscriber and return its writer.
///
/// Tests run in parallel in one process. With a single live subscriber,
/// `tracing` computes a call site's interest from the current thread only, so
/// a parallel test with no subscriber could cache a call site as "never" and
/// this test would lose the line. A permanently registered "sometimes"
/// dispatcher keeps every call site's interest at "sometimes".
pub fn capture(capacity: usize) -> (tracing::subscriber::DefaultGuard, LogWriter) {
    use tracing_subscriber::layer::SubscriberExt;
    static KEEP: std::sync::OnceLock<tracing::Dispatch> = std::sync::OnceLock::new();
    KEEP.get_or_init(|| tracing::Dispatch::new(Sometimes));
    let (layer, writer) = channel(capacity);
    let guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(layer.filtered()));
    (guard, writer)
}

struct Sometimes;

impl tracing::Subscriber for Sometimes {
    fn register_callsite(
        &self,
        _: &'static tracing::Metadata<'static>,
    ) -> tracing::subscriber::Interest {
        tracing::subscriber::Interest::sometimes()
    }
    fn enabled(&self, _: &tracing::Metadata<'_>) -> bool {
        false
    }
    fn max_level_hint(&self) -> Option<tracing::level_filters::LevelFilter> {
        None
    }
    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn event(&self, _: &tracing::Event<'_>) {}
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, thiserror::Error)]
    #[error("outer failed")]
    struct Outer(#[source] Inner);

    #[derive(Debug, thiserror::Error)]
    #[error("inner timed out")]
    struct Inner;

    #[test]
    fn error_chain_joins_every_cause() {
        assert_eq!(error_chain(&Outer(Inner)), "outer failed: inner timed out");
    }

    #[test]
    fn error_chain_of_a_leaf_is_its_message() {
        assert_eq!(error_chain(&Inner), "inner timed out");
    }
}
