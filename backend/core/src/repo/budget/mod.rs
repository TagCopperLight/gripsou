//! Budget persistence: the per-user taxonomy, its tags, and what a transaction
//! carries because of them. Every query is scoped through
//! `transaction -> account -> connection.user_id`; there is no other ownership
//! path.

pub mod ai;
pub mod assign;
pub mod category;
pub mod memo;
pub mod review;
pub mod summary;
pub mod tag;
