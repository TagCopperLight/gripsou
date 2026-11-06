use std::collections::HashMap;
use std::sync::Arc;

use gripsou_core::db::Db;
use gripsou_core::logs::error_chain;
use gripsou_core::repo::connection;

use crate::sync::{Trigger, claim};
use crate::{Deps, enabled_provider};

pub enum WebhookOutcome {
    /// Unknown, unconfigured or disabled provider.
    NotFound,
    /// Signature rejected.
    Unauthorized,
    /// Verified: acted on, ignored, or for an unknown connection.
    Accepted,
    /// The database could not say whether the provider is enabled: the
    /// provider retries.
    Unavailable,
}

/// Verify an incoming webhook and, if it signals a finished sync, claim the
/// connection and run the full-fetch. Always returns Accepted on a valid
/// signature so the provider stops retrying.
pub async fn handle_webhook(
    db: Db,
    deps: &Arc<Deps>,
    provider: &str,
    path: &str,
    headers: HashMap<String, String>,
    body: Vec<u8>,
) -> WebhookOutcome {
    let enabled = match enabled_provider(&db, provider).await {
        Ok(k) => k.is_some(),
        Err(e) => {
            tracing::error!(provider, error = %error_chain(&e), "webhook lookup failed");
            return WebhookOutcome::Unavailable;
        }
    };
    let Some(adapter) = deps.account(provider).filter(|_| enabled) else {
        tracing::warn!(provider, reason = "unknown_provider", "webhook rejected");
        return WebhookOutcome::NotFound;
    };
    let signal = match adapter.verify_webhook(path, &headers, &body) {
        Ok(Some(s)) => s,
        Ok(None) => {
            tracing::info!(provider, outcome = "ignored", "webhook received");
            return WebhookOutcome::Accepted;
        }
        Err(e) => {
            tracing::warn!(
                provider,
                reason = "bad_signature",
                error = %error_chain(&e),
                "webhook rejected"
            );
            return WebhookOutcome::Unauthorized;
        }
    };
    match connection::find_by_external_connection_id(&db, provider, &signal.provider_connection_id)
        .await
    {
        Ok(Some((id, user_id))) => {
            tracing::info!(provider, outcome = "matched", connection_id = %id, "webhook received");
            if let Some(claimed) = claim(&db, user_id, id, Trigger::Webhook).await {
                claimed.start(db.clone(), deps.clone());
            }
        }
        Ok(None) => tracing::warn!(
            provider,
            outcome = "unknown_connection",
            external_connection_id = %signal.provider_connection_id,
            "webhook received"
        ),
        Err(e) => {
            tracing::error!(provider, error = %error_chain(&e), "webhook lookup failed")
        }
    }
    WebhookOutcome::Accepted
}
