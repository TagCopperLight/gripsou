//! All of core's integration tests in one binary: one link instead of one
//! per file, and every test runs in parallel. `logs_install` stays its own
//! binary because it installs the process-wide subscriber.

mod backfill;
mod budget_ai_run;
mod budget_ai_usage;
mod budget_overview;
mod budget_pairing;
mod budget_schema;
mod budget_summary;
mod composition_sync;
mod fx;
mod golden;
mod ingest;
mod logs;
mod lot_basis;
mod lot_suggest;
mod price_sync;
mod provider_config;
mod query;
mod query_price_eligible;
mod query_review_rule;
mod query_transactions;
mod query_transactions_budget;
mod repo_account;
mod repo_budget_assign;
mod repo_budget_category;
mod repo_budget_review;
mod repo_budget_tag;
mod repo_connection;
mod repo_holding;
mod repo_instrument;
mod repo_instrument_resolution;
mod repo_lot;
mod repo_price;
mod repo_snapshot;
mod repo_transaction;
mod repo_users;
mod returns;
mod timezone;
