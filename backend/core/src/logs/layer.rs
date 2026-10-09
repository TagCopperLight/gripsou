//! Copies saved events (see [`is_saved`]) onto the writer's channel, with the
//! fields of every enclosing span merged in. Never blocks: a full channel
//! drops the line and counts it.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Map, Value};
use tokio::sync::mpsc;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Level, Metadata, Subscriber};
use tracing_subscriber::Layer;
use tracing_subscriber::filter::filter_fn;
use tracing_subscriber::layer::Context;
use tracing_subscriber::registry::LookupSpan;

use super::LogLine;

/// Saved: gripsou's own lines at info and above. Library chatter (sqlx,
/// hyper, reqwest) stays terminal-only; so does the writer, which never logs
/// through tracing, so saving can't loop.
pub fn is_saved(meta: &Metadata<'_>) -> bool {
    meta.target().starts_with("gripsou") && *meta.level() <= Level::INFO
}

#[derive(Clone)]
pub struct LogLayer {
    pub(super) tx: mpsc::Sender<LogLine>,
    pub(super) dropped: Arc<AtomicU64>,
}

impl LogLayer {
    /// The layer with its saving filter attached as a per-layer filter, so the
    /// terminal's `RUST_LOG` filter never decides what is saved.
    pub fn filtered<S>(self) -> impl Layer<S>
    where
        S: Subscriber + for<'a> LookupSpan<'a>,
    {
        self.with_filter(filter_fn(is_saved))
    }
}

/// A string value as saved: Postgres refuses a NUL (`\u0000`) in text and
/// jsonb, and one such line would make it reject the writer's whole batch.
fn text(v: &str) -> Value {
    if v.contains('\0') {
        Value::from(v.replace('\0', ""))
    } else {
        Value::from(v)
    }
}

/// A span's (or event's) fields as JSON.
#[derive(Default, Clone)]
struct Fields(Map<String, Value>);

impl Visit for Fields {
    fn record_str(&mut self, f: &Field, v: &str) {
        self.0.insert(f.name().into(), text(v));
    }
    fn record_i64(&mut self, f: &Field, v: i64) {
        self.0.insert(f.name().into(), Value::from(v));
    }
    fn record_u64(&mut self, f: &Field, v: u64) {
        self.0.insert(f.name().into(), Value::from(v));
    }
    fn record_bool(&mut self, f: &Field, v: bool) {
        self.0.insert(f.name().into(), Value::from(v));
    }
    fn record_f64(&mut self, f: &Field, v: f64) {
        self.0.insert(f.name().into(), Value::from(v));
    }
    fn record_error(&mut self, f: &Field, v: &(dyn std::error::Error + 'static)) {
        self.0.insert(f.name().into(), text(&super::error_chain(v)));
    }
    // `%x` and the message arrive here; their Debug is their Display.
    fn record_debug(&mut self, f: &Field, v: &dyn std::fmt::Debug) {
        self.0.insert(f.name().into(), text(&format!("{v:?}")));
    }
}

impl<S> Layer<S> for LogLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let mut f = Fields::default();
        attrs.record(&mut f);
        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(f);
        }
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(id)
            && let Some(f) = span.extensions_mut().get_mut::<Fields>()
        {
            values.record(f);
        }
    }

    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        let meta = event.metadata();
        let mut fields = Map::new();
        let mut spans = Vec::new();
        if let Some(scope) = ctx.event_scope(event) {
            for span in scope.from_root() {
                spans.push(Value::from(span.name()));
                if let Some(f) = span.extensions().get::<Fields>() {
                    fields.extend(f.0.clone());
                }
            }
        }
        let mut ev = Fields::default();
        event.record(&mut ev);
        let message = match ev.0.remove("message") {
            Some(Value::String(s)) => s,
            _ => String::new(),
        };
        fields.extend(ev.0);
        if !spans.is_empty() {
            fields.insert("spans".into(), Value::Array(spans));
        }
        let level = match *meta.level() {
            Level::ERROR => "error",
            Level::WARN => "warn",
            _ => "info",
        };
        let line = LogLine {
            at: chrono::Utc::now(),
            level,
            target: meta.target().to_string(),
            message,
            fields: Value::Object(fields),
        };
        if self.tx.try_send(line).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}
