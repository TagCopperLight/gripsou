//! The terminal output: tracing's usual line, with every UUID cut to its
//! first 8 characters. The saved log keeps them whole; this is only for
//! reading a sync's lines as they scroll by.

use std::fmt::{self, Write as _};

use tracing::field::Field;
use tracing_subscriber::field::MakeExt;
use tracing_subscriber::fmt::format::{Writer, debug_fn};
use tracing_subscriber::fmt::{FormatFields, MakeWriter};

/// Length of a shortened UUID: enough to tell this instance's rows apart.
const SHORT_ID: usize = 8;

/// Tracing's default field format (`message` bare, `name=value` for the
/// rest, strings quoted), except that a UUID value prints shortened.
pub(super) fn fields() -> impl for<'w> FormatFields<'w> + Send + Sync + 'static {
    debug_fn(write_field).delimited(" ")
}

fn write_field(w: &mut Writer<'_>, field: &Field, value: &dyn fmt::Debug) -> fmt::Result {
    let mut text = String::new();
    write!(text, "{value:?}")?;
    let text = short_uuid(&text);
    if field.name() == "message" {
        return w.write_str(text);
    }
    if w.has_ansi_escapes() {
        write!(w, "\x1b[3m{}\x1b[0m\x1b[2m=\x1b[0m{text}", field.name())
    } else {
        write!(w, "{}={text}", field.name())
    }
}

/// `1fe32d5a-d04f-490a-8771-529996fbfaee` → `1fe32d5a`; anything else as is.
fn short_uuid(text: &str) -> &str {
    if uuid::Uuid::try_parse(text).is_ok() {
        &text[..SHORT_ID]
    } else {
        text
    }
}

/// The terminal layer: colour only when `out` is a terminal, so redirected
/// output and `docker logs` carry no escape codes.
pub(super) fn layer<S, W>(out: W, ansi: bool) -> impl tracing_subscriber::Layer<S>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
    W: for<'w> MakeWriter<'w> + Send + Sync + 'static,
{
    tracing_subscriber::fmt::layer()
        .fmt_fields(fields())
        .with_ansi(ansi)
        .with_writer(out)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tracing_subscriber::layer::SubscriberExt;

    use super::*;

    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for Buffer {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'w> MakeWriter<'w> for Buffer {
        type Writer = Buffer;
        fn make_writer(&'w self) -> Buffer {
            self.clone()
        }
    }

    #[test]
    fn uuids_print_shortened_and_everything_else_as_before() {
        let out = Buffer::default();
        let subscriber = tracing_subscriber::registry().with(layer(out.clone(), false));
        let id = "1fe32d5a-d04f-490a-8771-529996fbfaee";
        tracing::subscriber::with_default(subscriber, || {
            let span = tracing::info_span!("sync", sync_id = %id, trigger = "manual");
            span.in_scope(|| {
                tracing::info!(connection_id = %id, accounts = 2, "sync finished");
            });
        });
        let line = String::from_utf8(out.0.lock().unwrap().clone()).unwrap();
        assert!(
            line.contains(r#"sync{sync_id=1fe32d5a trigger="manual"}"#),
            "{line}"
        );
        assert!(
            line.contains("sync finished connection_id=1fe32d5a accounts=2"),
            "{line}"
        );
        assert!(!line.contains(id), "{line}");
        assert!(
            !line.contains('\x1b'),
            "no colour when asked for none: {line}"
        );
    }
}
