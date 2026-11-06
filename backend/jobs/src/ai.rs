//! The AI categorisation run: who may have one, and one at a time per user.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use gripsou_core::budget::ai::RunOutcome;
use gripsou_core::db::Db;
use gripsou_core::repo::settings::BudgetAiSettings;
use gripsou_providers::registry::{self, Providers};
use tracing::Instrument;
use uuid::Uuid;

use crate::Deps;

/// The admin's AI choice as `(provider, model)`, when the provider is one
/// this build knows and its key is saved. A blank model is the provider's
/// default.
fn server_choice(
    settings: &BudgetAiSettings,
    providers: &Providers,
) -> Option<(&'static str, String)> {
    let kind = registry::categorizer_kind(settings.provider.as_deref()?)?;
    if !(kind.configured)(providers.config()) {
        return None;
    }
    let model = settings
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or(kind.default_model);
    Some((kind.about.key, model.to_string()))
}

/// Whether the server can categorise at all, whoever opted in.
pub async fn ai_configured(db: &Db, deps: &Deps) -> Result<bool, gripsou_core::error::CoreError> {
    let settings = gripsou_core::repo::settings::budget_ai(db).await?;
    Ok(server_choice(&settings, &deps.providers()).is_some())
}

/// `(provider, model)` when the server can categorise and the user opted in.
async fn open_gate(
    db: &Db,
    providers: &Providers,
    user_id: Uuid,
) -> Option<(&'static str, String)> {
    let settings = match gripsou_core::repo::settings::budget_ai(db).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %gripsou_core::logs::error_chain(&e), "ai settings unreadable");
            return None;
        }
    };
    let choice = server_choice(&settings, providers)?;
    match gripsou_core::repo::prefs::budget_ai_enabled(db, user_id).await {
        Ok(true) => Some(choice),
        Ok(false) => None,
        Err(e) => {
            tracing::error!(user_id = %user_id, error = %gripsou_core::logs::error_chain(&e), "ai opt-in unreadable");
            None
        }
    }
}

/// Whether a run would actually start — the API answers 409 when not.
pub async fn categorize_ready(db: &Db, deps: &Deps, user_id: Uuid) -> bool {
    open_gate(db, &deps.providers(), user_id).await.is_some()
}

/// Categorise one user's uncategorised rows. Never fails loudly: a run that
/// cannot start logs why; a run that fails, on the model or on the database,
/// records it in `budget_ai_run` for the banner.
async fn categorize_user(db: Db, deps: Arc<Deps>, user_id: Uuid) {
    let providers = deps.providers();
    let Some((kind, model)) = open_gate(&db, &providers, user_id).await else {
        return;
    };
    let Some(c) = providers.categorizer(kind, &model) else {
        tracing::error!(provider = %kind, "ai provider key missing");
        return;
    };
    match gripsou_core::budget::ai::run_for_user(&db, user_id, c.as_ref()).await {
        Ok(RunOutcome::Finished {
            outcome,
            items,
            batches,
        }) => tracing::info!(
            outcome = %outcome,
            items = items as i64,
            batches = batches as i64,
            "ai run finished"
        ),
        Ok(RunOutcome::Nothing) => tracing::debug!("ai run skipped: nothing to categorise"),
        Err(e) => tracing::error!(error = %gripsou_core::logs::error_chain(&e), "ai run failed"),
    }
}

/// Users with a run in this process, and whether another was asked for
/// meanwhile. The app is single-process, so this is every live run.
static AI_RUNS: LazyLock<Mutex<HashMap<Uuid, bool>>> = LazyLock::new(Default::default);

fn ai_runs() -> std::sync::MutexGuard<'static, HashMap<Uuid, bool>> {
    AI_RUNS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Whether the user has an AI run going (or booked to follow the current one).
pub fn ai_running(user_id: Uuid) -> bool {
    ai_runs().contains_key(&user_id)
}

/// Claims the user's run slot. False when a run is going: it is then asked to
/// go round once more instead.
fn claim_run(user_id: Uuid) -> bool {
    let mut runs = ai_runs();
    if let Some(again) = runs.get_mut(&user_id) {
        *again = true;
        return false;
    }
    runs.insert(user_id, false);
    true
}

/// After a run: true when another was asked for meanwhile (the slot is kept
/// for it), false when the slot is freed.
fn run_again(user_id: Uuid) -> bool {
    let mut runs = ai_runs();
    match runs.get_mut(&user_id) {
        Some(again) if *again => {
            *again = false;
            true
        }
        _ => {
            runs.remove(&user_id);
            false
        }
    }
}

/// What [`request_categorize`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Categorize {
    /// A run started.
    Started,
    /// The user's run is going: one more follows it.
    Booked,
}

/// Fire and forget: the run can take minutes. A request while the user's run
/// is going is not dropped: one more run follows it, however many requests
/// arrived, so rows a later sync brought in are not left for tomorrow.
pub fn request_categorize(db: Db, deps: Arc<Deps>, user_id: Uuid) -> Categorize {
    if !claim_run(user_id) {
        return Categorize::Booked;
    }
    tokio::spawn(async move {
        loop {
            guarded(
                &db,
                user_id,
                categorize_user(db.clone(), deps.clone(), user_id),
            )
            .instrument(gripsou_core::budget::ai::run_span(user_id))
            .await;
            if !run_again(user_id) {
                break;
            }
        }
    });
    Categorize::Started
}

/// One AI run once all of a user's `syncs` are in, if any of them ingested.
/// After the syncs, so a run never holds a sync's lock; after all of them,
/// because a run started after the first would miss the others' rows, and
/// could pay for transfer halves their pairing is about to claim.
pub(crate) async fn categorize_after(
    db: Db,
    deps: Arc<Deps>,
    user_id: Uuid,
    syncs: Vec<tokio::task::JoinHandle<bool>>,
) {
    let mut any_ok = false;
    for s in syncs {
        match s.await {
            Ok(ok) => any_ok |= ok,
            // A panicking sync is already caught and logged by its
            // supervisor; this is the supervisor itself dying.
            Err(e) => tracing::error!(user_id = %user_id, error = %e, "sync task crashed"),
        }
    }
    if any_ok {
        request_categorize(db, deps, user_id);
    }
}

/// Runs `run` in its own task so a panic is caught and the slot goes on to the
/// next run, instead of holding the user until a restart. Once the task has
/// ended, a run row it left `running` (a panic, or a failed close) is closed
/// as failed. Only for the task that owns the user's run.
async fn guarded<F>(db: &Db, user_id: Uuid, run: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    if let Err(e) = tokio::spawn(run.in_current_span()).await {
        // The panic payload is in JoinError's Display.
        tracing::error!(user_id = %user_id, error = %e, "ai run crashed");
    }
    if let Err(e) = gripsou_core::repo::budget::ai::close_abandoned_runs(db, Some(user_id)).await {
        tracing::error!(
            user_id = %user_id,
            error = %gripsou_core::logs::error_chain(&e),
            "ai run not closed"
        );
    }
}

#[cfg(test)]
mod categorize_gate_tests {
    use super::*;
    use gripsou_core::provider_config::ProviderConfig;
    use gripsou_providers::registry::Context;
    use sqlx::PgPool;

    fn providers(jev_key: bool) -> Providers {
        let mut c = ProviderConfig::default();
        if jev_key {
            c.set("jev", "api_key", Some("k".into()));
        }
        Providers::build(
            c,
            &Context {
                public_url: "https://g.example".into(),
            },
        )
    }

    fn s(p: Option<&str>, m: Option<&str>) -> BudgetAiSettings {
        BudgetAiSettings {
            provider: p.map(str::to_string),
            model: m.map(str::to_string),
        }
    }

    #[test]
    fn closed_when_the_server_has_no_provider() {
        assert_eq!(server_choice(&s(None, None), &providers(true)), None);
    }

    #[test]
    fn closed_when_the_key_is_missing() {
        assert_eq!(
            server_choice(&s(Some("jev"), None), &providers(false)),
            None
        );
    }

    /// The schema stores any provider key; one this build does not know (stale
    /// setting, typo) keeps the gate shut instead of failing mid-run.
    #[test]
    fn closed_when_the_admin_named_an_unknown_provider() {
        assert_eq!(
            server_choice(&s(Some("no-such-provider"), None), &providers(true)),
            None
        );
    }

    #[test]
    fn open_with_the_default_model_when_none_is_set() {
        assert_eq!(
            server_choice(&s(Some("jev"), Some("  ")), &providers(true)),
            Some(("jev", "jev-latest".to_string()))
        );
        assert_eq!(
            server_choice(&s(Some("jev"), Some("jev-2")), &providers(true)),
            Some(("jev", "jev-2".to_string()))
        );
    }

    /// Insert a user with `budget_ai_enabled = opted_in`.
    async fn seed_user(pool: &PgPool, opted_in: bool) -> Uuid {
        let id = gripsou_core::testkit::seed_user(pool).await;
        sqlx::query("update users set budget_ai_enabled = $2 where id = $1")
            .bind(id)
            .bind(opted_in)
            .execute(pool)
            .await
            .unwrap();
        id
    }

    /// The gate reads the admin's provider from `app_settings` and the opt-in
    /// from each user's own prefs. The admin configuring a provider is not
    /// consent: a user who did not opt in never has their transactions sent
    /// to a model, and one user's opt-in never opens it for another.
    #[sqlx::test(migrations = "../migrations")]
    async fn open_only_for_the_users_who_opted_in(pool: PgPool) {
        let opted_in = seed_user(&pool, true).await;
        let other = seed_user(&pool, false).await;
        let p = providers(true);
        assert_eq!(
            open_gate(&pool, &p, opted_in).await,
            None,
            "AI off server-wide"
        );
        sqlx::query("update app_settings set budget_ai_provider = 'jev' where id = 1")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            open_gate(&pool, &p, opted_in).await,
            Some(("jev", "jev-latest".to_string()))
        );
        assert_eq!(open_gate(&pool, &p, other).await, None);
    }
}

#[cfg(test)]
mod categorize_run_tests {
    use super::*;
    use sqlx::PgPool;
    use std::time::Duration;

    fn deps() -> Arc<Deps> {
        Arc::new(crate::testing::deps())
    }

    #[test]
    fn requests_during_a_run_coalesce_into_one_more_run() {
        let user = Uuid::new_v4();
        assert!(claim_run(user), "the first request starts a run");
        assert!(!claim_run(user), "a second one waits for it");
        assert!(!claim_run(user), "and a third joins the second");
        assert!(run_again(user), "one more run follows");
        assert!(!run_again(user), "then the slot is freed");
        assert!(claim_run(user), "and the next request starts afresh");
        assert!(!run_again(user));
    }

    /// One user's run must not block another's: the slot is per user, so a
    /// long run for A never leaves B's new rows uncategorised.
    #[test]
    fn run_slots_are_per_user() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        assert!(claim_run(a));
        assert!(claim_run(b), "B starts while A runs");
        assert!(!run_again(a), "A's slot is freed without a re-run");
        assert!(!run_again(b), "B was never asked twice either");
    }

    /// Simultaneous requests (several syncs finishing at once) start exactly
    /// one run: two would pay the model twice for the same rows.
    #[test]
    fn concurrent_requests_start_a_single_run() {
        let user = Uuid::new_v4();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(16));
        let handles: Vec<_> = (0..16)
            .map(|_| {
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    claim_run(user)
                })
            })
            .collect();
        let winners = handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|won| *won)
            .count();
        assert_eq!(winners, 1);
        assert!(run_again(user), "the losers asked for one more run");
        assert!(!run_again(user), "and only one");
    }

    /// A request while the user's run is in flight starts no second task: it
    /// only books one more round, which the running task picks up.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_request_during_a_run_books_a_rerun_instead_of_starting_one(pool: PgPool) {
        let user = Uuid::new_v4();
        assert!(claim_run(user), "a run is in flight");
        assert_eq!(
            request_categorize(pool.clone(), deps(), user),
            Categorize::Booked
        );
        assert_eq!(
            request_categorize(pool.clone(), deps(), user),
            Categorize::Booked
        );
        assert!(run_again(user), "the running task goes round once more");
        assert!(!run_again(user), "then frees the slot");
    }

    /// A run that cannot start (AI off) must still free the user's slot, or
    /// every later request would be swallowed until a restart.
    #[sqlx::test(migrations = "../migrations")]
    async fn a_run_that_cannot_start_frees_the_slot(pool: PgPool) {
        let user = gripsou_core::testkit::seed_user(&pool).await;
        assert_eq!(
            request_categorize(pool.clone(), deps(), user),
            Categorize::Started
        );
        let freed = async {
            while ai_runs().contains_key(&user) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        };
        tokio::time::timeout(Duration::from_secs(10), freed)
            .await
            .expect("the slot is freed once the no-op run ends");
        assert!(claim_run(user), "the next request starts a run");
        assert!(!run_again(user));
    }

    #[sqlx::test(migrations = "../migrations")]
    async fn a_panicking_run_closes_its_row(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(100);
        let user = gripsou_core::testkit::seed_user(&pool).await;
        let p = pool.clone();
        guarded(&pool, user, async move {
            gripsou_core::repo::budget::ai::start_run(&p, user, "mock:m")
                .await
                .unwrap();
            panic!("boom");
        })
        .await;

        let run = gripsou_core::repo::budget::ai::last_run(&pool, user)
            .await
            .unwrap()
            .expect("the dead run is reported");
        assert_eq!(
            run.outcome,
            gripsou_core::budget::vocab::AiRunOutcome::Error
        );

        writer.flush(&pool).await;
        let f: serde_json::Value =
            sqlx::query_scalar("select fields from log where message = 'ai run crashed'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(f["user_id"], user.to_string());
        assert!(f["error"].as_str().unwrap().contains("boom"));
    }
}
