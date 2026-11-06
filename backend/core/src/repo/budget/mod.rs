//! Budget persistence: the per-user taxonomy, its tags, and what a transaction
//! carries because of them. Every query reaches a user's transactions through
//! the `user_transactions` SQL function, or `budget_transactions` (the same
//! rows without the cash leg of a buy/sell) for what the budget reads.

pub mod ai;
pub mod assign;
pub mod category;
pub mod review;
pub mod summary;
pub mod tag;
pub mod transactions;
