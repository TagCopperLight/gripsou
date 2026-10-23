//! Seeders the api's tests share on top of `gripsou_core::testkit`: the ones
//! that need the api's own password and session hashing.

use crate::auth::{self, AuthUser};
use gripsou_core::repo::session;
use sqlx::PgPool;
use uuid::Uuid;

/// The job deps with whatever adapters the environment configures.
pub(crate) fn deps() -> std::sync::Arc<gripsou_jobs::Deps> {
    let key = gripsou_core::testkit::encryption_key();
    std::sync::Arc::new(gripsou_jobs::Deps::from_env(key, "EUR".into()))
}

/// The password `seed_user` gives its users.
pub(crate) const PASSWORD: &str = "hunter22";

/// A user who can log in with `PASSWORD`.
pub(crate) async fn seed_user(pool: &PgPool, email: &str) -> Uuid {
    seed_user_with_password(pool, email, PASSWORD, "user").await
}

/// A user who can log in with `password`.
pub(crate) async fn seed_user_with_password(
    pool: &PgPool,
    email: &str,
    password: &str,
    role: &str,
) -> Uuid {
    let hash = auth::hash_password(password).unwrap();
    gripsou_core::testkit::seed_user_as(pool, email, role, &hash).await
}

pub(crate) async fn seed_session(pool: &PgPool, user_id: Uuid) -> AuthUser {
    let s = session::create(
        pool,
        user_id,
        &auth::hash_token(&auth::generate_token()),
        None,
        None,
        false,
        chrono::Utc::now() + chrono::Duration::days(1),
    )
    .await
    .unwrap();
    AuthUser {
        user_id,
        session_id: s.id,
    }
}

pub(crate) fn who(a: &AuthUser) -> AuthUser {
    AuthUser {
        user_id: a.user_id,
        session_id: a.session_id,
    }
}

pub(crate) async fn sessions(pool: &PgPool, user_id: Uuid) -> i64 {
    sqlx::query_scalar("select count(*) from session where user_id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap()
}
