#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("encryption error: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),

    #[error("instrument '{name}' has no isin or symbol to identify it")]
    MissingInstrumentId { name: String },

    #[error("sync result references unknown account '{external_id}'")]
    UnknownAccountRef { external_id: String },

    /// The API answers 404 either way, so it never confirms ids the caller can't see.
    #[error("{0}")]
    NotFound(&'static str),
}
