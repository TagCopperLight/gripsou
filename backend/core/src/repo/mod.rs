//! A function a transaction may need to run takes `impl PgExecutor` (one statement) or
//! `&mut PgConnection` (several), so it runs on the pool or in the caller's transaction. One that
//! opens its own transaction, or that only request handlers call, takes `&PgPool`.

pub mod account;
pub mod budget;
pub mod connection;
pub mod holding;
pub mod instrument;
pub mod invite_token;
pub mod log;
pub mod login_challenge;
pub mod lot;
pub mod lot_suggest;
pub mod mfa;
pub mod passkey;
pub mod prefs;
pub mod price;
pub mod provider_config;
pub mod returns;
pub mod series;
pub mod session;
pub mod settings;
pub mod snapshot;
pub mod transaction;
pub mod user;
pub mod valuation;
