//! Integration tests for the budget AI gate (`gripsou_jobs::categorize_ready`
//! and `categorize_user`): a run starts only when the admin picked a provider
//! whose API key the server has *and* the user opted in.
//!
//! Env-isolation note: which providers are "available" comes from their API
//! key env vars, which are process-global. Every test in this file pins the
//! same environment through `pin_env` (Gemini key set, Jev key absent), so the
//! tests agree with each other whatever the developer's shell exports. No
//! test here reaches a model: in every case that would open the gate, only
//! `categorize_ready` is called, which never builds a categorizer.

use std::sync::Once;

use sqlx::PgPool;
use uuid::Uuid;

fn pin_env() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| unsafe {
        std::env::set_var("GEMINI_API_KEY", "test-gemini-key");
        std::env::remove_var("JEV_API_KEY");
    });
}

/// Insert a user whose prefs carry `budgetAiEnabled = opted_in`.
async fn seed_user(pool: &PgPool, opted_in: bool) -> Uuid {
    let user_id = Uuid::new_v4();
    sqlx::query(
        "insert into users (id, email, name, password_hash, prefs) \
         values ($1, $2, 'Test', 'x', jsonb_build_object('budgetAiEnabled', $3::boolean))",
    )
    .bind(user_id)
    .bind(format!("u-{user_id}@test.local"))
    .bind(opted_in)
    .execute(pool)
    .await
    .unwrap();
    user_id
}

/// Set the admin's provider choice (`None` = AI off server-wide).
async fn set_admin_provider(pool: &PgPool, provider: Option<&str>) {
    sqlx::query(
        "update app_settings set budget_ai_provider = $1, budget_ai_model = null where id = 1",
    )
    .bind(provider)
    .execute(pool)
    .await
    .unwrap();
}

/// With neither the admin nor the user having switched the AI on, nothing runs.
#[sqlx::test(migrations = "../migrations")]
async fn not_ready_when_neither_admin_nor_user_enabled_it(pool: PgPool) {
    pin_env();
    let user = seed_user(&pool, false).await;
    set_admin_provider(&pool, None).await;
    assert!(!gripsou_jobs::categorize_ready(&pool, user).await);
}

/// The admin configuring a provider is not consent: a user who did not opt in
/// never has their transactions sent to a model.
#[sqlx::test(migrations = "../migrations")]
async fn not_ready_when_only_the_admin_enabled_it(pool: PgPool) {
    pin_env();
    let user = seed_user(&pool, false).await;
    set_admin_provider(&pool, Some("gemini")).await;
    assert!(!gripsou_jobs::categorize_ready(&pool, user).await);
}

/// A user's opt-in alone does nothing while the admin has not picked a provider.
#[sqlx::test(migrations = "../migrations")]
async fn not_ready_when_only_the_user_opted_in(pool: PgPool) {
    pin_env();
    let user = seed_user(&pool, true).await;
    set_admin_provider(&pool, None).await;
    assert!(!gripsou_jobs::categorize_ready(&pool, user).await);
}

/// Admin provider with its key present plus user opt-in: the run may start.
#[sqlx::test(migrations = "../migrations")]
async fn ready_when_admin_and_user_both_enabled_it(pool: PgPool) {
    pin_env();
    let user = seed_user(&pool, true).await;
    set_admin_provider(&pool, Some("gemini")).await;
    assert!(gripsou_jobs::categorize_ready(&pool, user).await);
}

/// The schema stores any provider key; one this build does not know (stale
/// setting, typo) keeps the gate shut instead of failing mid-run.
#[sqlx::test(migrations = "../migrations")]
async fn not_ready_when_the_admin_named_an_unknown_provider(pool: PgPool) {
    pin_env();
    let user = seed_user(&pool, true).await;
    set_admin_provider(&pool, Some("no-such-provider")).await;
    assert!(!gripsou_jobs::categorize_ready(&pool, user).await);
}

/// A known provider whose API key was removed from the server's env keeps the
/// gate shut, so the API answers 409 rather than queuing a run that cannot
/// reach the model.
#[sqlx::test(migrations = "../migrations")]
async fn not_ready_when_the_providers_api_key_is_missing(pool: PgPool) {
    pin_env();
    let user = seed_user(&pool, true).await;
    set_admin_provider(&pool, Some("jev")).await;
    assert!(!gripsou_jobs::categorize_ready(&pool, user).await);
}

/// The gate is per user: one user's opt-in never opens it for another.
#[sqlx::test(migrations = "../migrations")]
async fn one_users_opt_in_does_not_open_the_gate_for_another(pool: PgPool) {
    pin_env();
    let opted_in = seed_user(&pool, true).await;
    let other = seed_user(&pool, false).await;
    set_admin_provider(&pool, Some("gemini")).await;
    assert!(gripsou_jobs::categorize_ready(&pool, opted_in).await);
    assert!(!gripsou_jobs::categorize_ready(&pool, other).await);
}

/// `categorize_user` honours the gate itself, not just the API's pre-check:
/// a sync-triggered run for a user who did not opt in never reaches the run
/// machinery. Probe: an open `running` row, which any run that gets past the
/// gate closes as abandoned before looking for work (and, with no
/// transactions seeded, before any model call).
#[sqlx::test(migrations = "../migrations")]
async fn categorize_user_does_nothing_without_the_users_opt_in(pool: PgPool) {
    pin_env();
    let user = seed_user(&pool, false).await;
    set_admin_provider(&pool, Some("gemini")).await;
    let probe: Uuid = sqlx::query_scalar(
        "insert into budget_ai_run (user_id, model) values ($1, 'probe:m') returning id",
    )
    .bind(user)
    .fetch_one(&pool)
    .await
    .unwrap();

    gripsou_jobs::categorize_user(pool.clone(), user).await;

    let outcome: String = sqlx::query_scalar("select outcome from budget_ai_run where id = $1")
        .bind(probe)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(outcome, "running", "the run machinery was entered");
    let runs: i64 = sqlx::query_scalar("select count(*) from budget_ai_run where user_id = $1")
        .bind(user)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(runs, 1, "no run was recorded");
}
