//! Adding a connection (the provider's auth round-trip) and opening its
//! management page.

use std::collections::HashMap;
use std::sync::Arc;

use gripsou_core::db::Db;
use gripsou_core::error::CoreError;
use gripsou_core::logs::error_chain;
use gripsou_core::provider::{ConnectInit, ProviderError};
use gripsou_core::repo::connection;
use uuid::Uuid;

use crate::sync::{Trigger, request_sync};
use crate::{Deps, credentials};

/// Credentials never leave the server; the returned URL contains a single-use code.
pub async fn manage_connection(
    deps: &Deps,
    conn: &connection::ConnForSync,
) -> Result<ConnectInit, ProviderError> {
    let adapter = deps
        .account(conn.provider_key.as_str())
        .filter(|p| p.supports_manage())
        .ok_or(ProviderError::NotImplemented)?;
    let credentials = credentials::open(&deps.key, &conn.credentials)
        .map_err(|_| ProviderError::Other("connection credentials unavailable".into()))?;
    adapter.manage(&credentials, &conn.provider_meta).await
}

/// Begin a provider connection: check the adapter exists, call `connect()`,
/// create a pending DB row, and append `state=<id>` to the redirect URL.
///
/// Calling `connect()` before inserting the row avoids leaving orphaned
/// pending rows when the provider refuses (e.g. keys not saved).
pub async fn init_connection(
    db: Db,
    deps: &Deps,
    user_id: Uuid,
    provider_key: &str,
    display_name: &str,
) -> Result<(Uuid, ConnectInit), ProviderError> {
    let adapter = deps
        .account(provider_key)
        .ok_or_else(|| ProviderError::Other(format!("no adapter for provider '{provider_key}'")))?;

    let init = adapter.connect().await?;

    let connection_id = connection::insert_pending(&db, user_id, provider_key, display_name)
        .await
        .map_err(|e| ProviderError::Other(e.to_string()))?;
    tracing::info!(connection_id = %connection_id, user_id = %user_id, provider = provider_key, "connection created");

    let init = ConnectInit {
        redirect_url: init.redirect_url.map(|url| {
            let sep = if url.contains('?') { '&' } else { '?' };
            format!("{url}{sep}state={connection_id}")
        }),
    };

    Ok((connection_id, init))
}

/// Why [`complete_connection`] failed.
#[derive(Debug)]
pub enum CompleteError {
    /// No connection with this id belongs to the user.
    NotFound,
    /// The provider refused or failed the callback.
    Provider(ProviderError),
    /// Our side failed (database, encryption, a missing adapter).
    Internal(String),
}

impl From<ProviderError> for CompleteError {
    fn from(e: ProviderError) -> Self {
        CompleteError::Provider(e)
    }
}

/// Complete a pending connection: call `complete_connect()`, encrypt the
/// returned credentials, and flip status to 'ok'. On failure (including a
/// callback the user cancelled) the pending row is deleted, so it never shows
/// as "Connecting…"; the stale-pending sweep covers callbacks that never come.
pub async fn complete_connection(
    db: Db,
    deps: &Arc<Deps>,
    user_id: Uuid,
    connection_id: Uuid,
    params: &HashMap<String, String>,
) -> Result<(), CompleteError> {
    let result = finish_connection(db.clone(), deps, user_id, connection_id, params).await;
    if result.is_err()
        && let Err(e) = connection::delete_pending(&db, user_id, connection_id).await
    {
        tracing::error!(
            connection_id = %connection_id,
            error = %error_chain(&e),
            "pending connection delete failed"
        );
    }
    result
}

async fn finish_connection(
    db: Db,
    deps: &Arc<Deps>,
    user_id: Uuid,
    connection_id: Uuid,
    params: &HashMap<String, String>,
) -> Result<(), CompleteError> {
    let internal = |e: CoreError| CompleteError::Internal(error_chain(&e));
    let provider_key = connection::provider_key(&db, connection_id)
        .await
        .map_err(internal)?
        .ok_or(CompleteError::NotFound)?;

    let adapter = deps
        .account(provider_key.as_str())
        .ok_or_else(|| CompleteError::Internal(format!("no adapter for '{provider_key}'")))?;

    let completed = adapter.complete_connect(params).await?;
    let encrypted =
        credentials::seal(&deps.key, &completed.credentials).map_err(CompleteError::Internal)?;

    let updated = connection::finish_connect(
        &db,
        connection_id,
        user_id,
        encrypted,
        completed.provider_meta,
    )
    .await
    .map_err(internal)?;
    if !updated {
        return Err(CompleteError::NotFound);
    }
    tracing::info!(connection_id = %connection_id, user_id = %user_id, provider = %provider_key, "connection activated");
    // Kick an initial sync (webhook providers go 'awaiting'; others fetch now).
    // The connect itself has succeeded either way, so a failure here is logged,
    // not returned — but it must not be invisible.
    match request_sync(db.clone(), deps, user_id, connection_id, Trigger::Initial).await {
        Ok(_) => {} // started or skipped: both already logged
        Err(e) => tracing::error!(
            connection_id = %connection_id,
            error = %error_chain(&e),
            "initial sync failed to start"
        ),
    }
    Ok(())
}
