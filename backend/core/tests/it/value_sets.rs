//! Each closed value set's variants against the database's own list, so a
//! migration that adds a value, or a variant added without one, fails here.

use std::collections::BTreeSet;

use gripsou_core::budget::vocab::{AiRunOutcome, CategoryKind, CategorySource, SeedKey, SystemKey};
use gripsou_core::repo::connection::ConnectionStatus;
use gripsou_core::repo::invite_token::TokenKind;
use gripsou_core::repo::login_challenge::ChallengeKind;
use gripsou_core::repo::lot::{LotSide, LotSource};
use gripsou_core::repo::user::Role;
use sqlx::PgPool;

/// The values `table.column`'s check constraint allows. Postgres prints an
/// `in (...)` check as `(column = ANY (ARRAY['a'::text, 'b'::text]))`.
async fn allowed(pool: &PgPool, table: &str, column: &str) -> BTreeSet<String> {
    let defs: Vec<String> = sqlx::query_scalar(
        "select pg_get_constraintdef(oid) from pg_constraint \
          where conrelid = $1::regclass and contype = 'c' \
            and pg_get_constraintdef(oid) like '%(' || $2 || ' = ANY%'",
    )
    .bind(table)
    .bind(column)
    .fetch_all(pool)
    .await
    .unwrap();
    let [def] = defs.as_slice() else {
        panic!("expected one check on {table}.{column}, found {defs:?}");
    };
    def.split('\'')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

fn spelled(all: &[impl ToString]) -> BTreeSet<String> {
    all.iter().map(ToString::to_string).collect()
}

#[sqlx::test(migrations = "../migrations")]
async fn category_kind(pool: PgPool) {
    assert_eq!(
        spelled(CategoryKind::ALL),
        allowed(&pool, "budget_category", "kind").await
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn category_source(pool: PgPool) {
    assert_eq!(
        spelled(CategorySource::ALL),
        allowed(&pool, "transaction", "category_source").await
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn ai_run_outcome(pool: PgPool) {
    assert_eq!(
        spelled(AiRunOutcome::ALL),
        allowed(&pool, "budget_ai_run", "outcome").await
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn connection_status(pool: PgPool) {
    assert_eq!(
        spelled(ConnectionStatus::ALL),
        allowed(&pool, "connection", "status").await
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn challenge_kind(pool: PgPool) {
    assert_eq!(
        spelled(ChallengeKind::ALL),
        allowed(&pool, "login_challenge", "kind").await
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn token_kind(pool: PgPool) {
    assert_eq!(
        spelled(TokenKind::ALL),
        allowed(&pool, "invite_token", "type").await
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn role(pool: PgPool) {
    assert_eq!(spelled(Role::ALL), allowed(&pool, "users", "role").await);
}

#[sqlx::test(migrations = "../migrations")]
async fn lot_side(pool: PgPool) {
    assert_eq!(spelled(LotSide::ALL), allowed(&pool, "lot", "side").await);
}

#[sqlx::test(migrations = "../migrations")]
async fn lot_source(pool: PgPool) {
    assert_eq!(
        spelled(LotSource::ALL),
        allowed(&pool, "lot", "source").await
    );
}

/// Seed and system keys have no check: the seed function is their list, so
/// every key the code names must be on a new user's categories.
#[sqlx::test(migrations = "../migrations")]
async fn seed_and_system_keys(pool: PgPool) {
    let user = gripsou_core::testkit::seed_user(&pool).await;
    let (seeds, systems): (Vec<Option<String>>, Vec<Option<String>>) =
        sqlx::query_as::<_, (Option<String>, Option<String>)>(
            "select seed_key, system_key from budget_category where user_id = $1",
        )
        .bind(user)
        .fetch_all(&pool)
        .await
        .unwrap()
        .into_iter()
        .unzip();
    let seeds: BTreeSet<String> = seeds.into_iter().flatten().collect();
    let systems: BTreeSet<String> = systems.into_iter().flatten().collect();
    assert!(spelled(SeedKey::ALL).is_subset(&seeds), "{seeds:?}");
    assert_eq!(spelled(SystemKey::ALL), systems);
}

/// `UserPrefs::default()` is what the frontend shows before sign-in; a new
/// user's row must read back the same.
#[sqlx::test(migrations = "../migrations")]
async fn new_user_prefs_are_the_defaults(pool: PgPool) {
    let user = gripsou_core::testkit::seed_user(&pool).await;
    let stored = gripsou_core::repo::prefs::get(&pool, user)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(stored).unwrap(),
        serde_json::to_value(gripsou_core::repo::prefs::UserPrefs::default()).unwrap()
    );
}
