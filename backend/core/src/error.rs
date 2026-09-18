//! Error type for core persistence operations.

use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),

    /// A non-cash instrument reference carried neither an ISIN nor a symbol,
    /// so it cannot be deduplicated into a global instrument row.
    #[error("instrument '{name}' has no isin or symbol to identify it")]
    MissingInstrumentId { name: String },

    /// A holding or transaction referenced an account `external_id` that was
    /// not present among the sync result's accounts.
    #[error("sync result references unknown account '{external_id}'")]
    UnknownAccountRef { external_id: String },

    /// The internal-transfer pairing pass computed a pair but the write that
    /// should have stamped both rows touched fewer than two of them — most
    /// likely because this user has no `internal_transfer` budget_category
    /// row (it is trigger-seeded on user creation and delete-protected, so
    /// this should never happen). Surfaced as a hard error rather than
    /// silently doing nothing: the pass loops rounds until a round pairs
    /// nothing, and a silently-unwritten "pair" would make it recompute and
    /// resubmit the same pair forever, inside the caller's transaction.
    #[error(
        "pairing transaction {out_id} with {in_id} for user {user_id} affected {rows} rows, expected 2 \
         (does this user have an internal_transfer budget_category row?)"
    )]
    TransferPairNotWritten {
        user_id: Uuid,
        out_id: Uuid,
        in_id: Uuid,
        rows: u64,
    },
}
