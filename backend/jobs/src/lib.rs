//! Everything that runs a provider: the scheduler, syncs, connects,
//! webhooks and AI runs. One task and one lock per connection.

mod ai;
mod connect;
pub mod credentials;
mod deps;
mod scheduler;
mod sync;
mod webhook;

pub use ai::{Categorize, ai_configured, ai_running, categorize_ready, request_categorize};
pub use connect::{ConnectError, complete_connection, init_connection, manage_connection};
pub use deps::{Deps, enabled_provider, enabled_providers};
pub use scheduler::run_scheduler;
pub use sync::{Trigger, request_sync};
pub use webhook::{WebhookOutcome, handle_webhook};

/// Entry points for tests.
#[cfg(feature = "test-util")]
pub mod testing {
    use std::sync::Arc;

    use gripsou_core::db::Db;
    use uuid::Uuid;

    use crate::{Deps, Trigger};

    /// Claims the connection and runs its sync to the end, without the AI
    /// run. `None` when the claim is refused; else whether it ingested.
    pub async fn sync(
        db: Db,
        deps: Arc<Deps>,
        user_id: Uuid,
        connection_id: Uuid,
        trigger: Trigger,
    ) -> Option<bool> {
        let claimed = crate::sync::claim(&db, user_id, connection_id, trigger).await?;
        Some(claimed.spawn(db, deps).await.expect("supervised sync"))
    }

    /// Deps built from an empty provider config, with the test key.
    pub fn deps() -> Deps {
        Deps::build(
            gripsou_core::testkit::encryption_key(),
            "EUR".into(),
            "http://localhost:5173".into(),
            Default::default(),
        )
        .unwrap()
    }
}
