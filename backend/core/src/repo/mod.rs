//! Persistence helpers: one focused function per entity, each taking a
//! `&mut PgConnection` so the ingest orchestrator can run them in one
//! transaction. All queries use sqlx's compile-time-checked macros.

pub mod account;
pub mod holding;
pub mod instrument;
pub mod price;
pub mod snapshot;
pub mod transaction;
