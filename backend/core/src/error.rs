//! Error type for core persistence operations.

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
}
