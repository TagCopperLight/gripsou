//! Logging support: the saved-log layer and writer, and helpers every log
//! site uses. Conventions (fixed messages, shared field names, levels) are in
//! CLAUDE.md "Logs".

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
