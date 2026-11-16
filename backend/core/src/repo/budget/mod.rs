//! Budget persistence: the per-user taxonomy, its tags, and what a transaction carries because of them.
//! Queries reach a user's transactions through `user_transactions`, or `budget_transactions` (without the
//! cash leg of a buy/sell) for what the budget reads.

pub mod ai;
pub mod assign;
pub mod category;
pub mod review;
pub mod summary;
pub mod tag;
pub mod transactions;
