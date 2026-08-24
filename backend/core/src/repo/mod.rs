//! Persistence helpers: one focused function per entity, each taking a
//! `&mut PgConnection` so the ingest orchestrator can run them in one
//! transaction. All queries use sqlx's compile-time-checked macros.

pub mod account;
pub mod connection;
pub mod holding;
pub mod instrument;
pub mod invite_token;
pub mod prefs;
pub mod price;
pub mod provider;
pub mod query;
pub mod series;
pub mod session;
pub mod settings;
pub mod snapshot;
pub mod transaction;
pub mod user;
