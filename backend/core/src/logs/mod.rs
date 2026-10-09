//! Logging support: the saved-log layer and writer, and helpers every log
//! site uses. Conventions (fixed messages, shared field names, levels) are in
//! CLAUDE.md "Logs".

mod layer;
mod writer;

pub use layer::{LogLayer, is_saved};
pub use writer::{LogWriter, WriterHandle};

/// Lines held in memory while the database is slow or down.
pub const QUEUE_CAPACITY: usize = 10_000;

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
