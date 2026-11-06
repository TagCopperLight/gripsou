//! Seeders the api's tests share on top of `gripsou_core::testkit`: the ones
//! that need the api's own password and session hashing.

use crate::auth::client::Client;
use crate::auth::login::login;
use crate::auth::throttle::Throttles;
use crate::auth::{self, AuthUser, factors};
use crate::dto::{self, LoginReq};
use crate::error::ApiError;
use axum::Json;
use axum::extract::State;
use gripsou_core::repo::session;
pub(crate) use gripsou_core::repo::user::Role;
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

/// The job deps with whatever adapters the saved keys configure.
pub(crate) fn deps() -> std::sync::Arc<gripsou_jobs::Deps> {
    let key = gripsou_core::testkit::encryption_key();
    std::sync::Arc::new(
        gripsou_jobs::Deps::build(
            key,
            "EUR".into(),
            "http://localhost:5173".into(),
            Default::default(),
        )
        .unwrap(),
    )
}

/// The password `seed_user` gives its users.
pub(crate) const PASSWORD: &str = "hunter22";

/// A user who can log in with `PASSWORD`.
pub(crate) async fn seed_user(pool: &PgPool, email: &str) -> Uuid {
    seed_user_with_password(pool, email, PASSWORD, Role::User).await
}

/// A user who can log in with `password`.
pub(crate) async fn seed_user_with_password(
    pool: &PgPool,
    email: &str,
    password: &str,
    role: Role,
) -> Uuid {
    let hash = auth::password::hash(password).unwrap();
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

/// Enrol TOTP for `user_id` with a secret encrypted under the test key and
/// ten recovery codes; returns the secret and the plain recovery codes.
pub(crate) async fn enable_totp(pool: &PgPool, user_id: Uuid) -> (Vec<u8>, Vec<String>) {
    use gripsou_core::repo::mfa;
    let secret = factors::new_totp_secret();
    let enc = gripsou_core::testkit::encryption_key()
        .encrypt(&secret)
        .unwrap();
    assert!(
        mfa::upsert_unconfirmed_totp(pool, user_id, &enc)
            .await
            .unwrap()
    );
    let codes = factors::new_recovery_codes();
    assert!(
        mfa::confirm_totp(pool, user_id, &enc, 0, &codes.hashes)
            .await
            .unwrap()
    );
    (secret, codes.plain)
}

/// The authenticator code for `secret` right now.
pub(crate) fn totp_now(secret: &[u8]) -> String {
    let now = chrono::Utc::now().timestamp() as u64;
    factors::totp_code(secret, factors::current_step(now))
}

/// A well-formed code that isn't [`totp_now`].
pub(crate) fn wrong_totp(secret: &[u8]) -> String {
    if totp_now(secret) == "000000" {
        "000001".into()
    } else {
        "000000".into()
    }
}

/// Limiters with nothing counted yet.
pub(crate) fn throttles() -> Arc<Throttles> {
    Arc::new(Throttles::default())
}

/// A caller on localhost whose browser sent no User-Agent.
pub(crate) fn local() -> Client {
    Client {
        ip: "127.0.0.1".into(),
        user_agent: String::new(),
    }
}

pub(crate) async fn login_as(
    pool: &PgPool,
    throttles: &Arc<Throttles>,
    client: Client,
    email: &str,
    pw: &str,
    remember: bool,
) -> Result<Json<dto::LoginOutcome>, ApiError> {
    login(
        State(pool.clone()),
        State(throttles.clone()),
        client,
        Json(LoginReq {
            email: email.into(),
            password: pw.into(),
            remember,
        }),
    )
    .await
}

pub(crate) async fn login_outcome(
    pool: &PgPool,
    throttles: &Arc<Throttles>,
    email: &str,
    pw: &str,
    remember: bool,
) -> dto::LoginOutcome {
    login_as(pool, throttles, local(), email, pw, remember)
        .await
        .expect("login ok")
        .0
}

/// A fresh reauth token for `a`, bought with `password`.
pub(crate) async fn reauth_token(pool: &PgPool, a: &AuthUser, password: &str) -> String {
    crate::auth::mfa::reauth(
        State(pool.clone()),
        State(throttles()),
        local(),
        who(a),
        Json(dto::ReauthReq {
            password: password.into(),
        }),
    )
    .await
    .unwrap()
    .0
    .reauth
}

/// Seed an admin user and return their id — mirrors what `seed_user` does for
/// the existing tests (email "a@t.local").
pub(crate) async fn seed_admin_user(pool: &PgPool) -> Uuid {
    seed_admin(pool, "a@t.local", "hunter2").await
}

pub(crate) async fn seed_admin(pool: &PgPool, email: &str, password: &str) -> Uuid {
    seed_user_with_password(pool, email, password, Role::Admin).await
}

pub(crate) async fn login_token(pool: &PgPool, email: &str, pw: &str) -> String {
    match login_outcome(pool, &throttles(), email, pw, false).await {
        dto::LoginOutcome::Session(r) => r.token,
        other => panic!("expected a session, got {other:?}"),
    }
}

pub(crate) async fn principal_for(pool: &PgPool, email: &str, pw: &str) -> auth::AuthUser {
    let token = login_token(pool, email, pw).await;
    let session = gripsou_core::repo::session::find_valid_by_hash(pool, &auth::hash_token(&token))
        .await
        .unwrap()
        .unwrap();
    auth::AuthUser {
        user_id: session.user_id,
        session_id: session.id,
    }
}

/// Insert a user + connection, returning the connection id (mirrors
/// core's `common::seed_connection`, but this crate can't import that
/// test-only module across crates).
pub(crate) async fn seed_connection(pool: &PgPool, email: &str) -> Uuid {
    let user_id = seed_user_with_password(pool, email, "hunter2", Role::User).await;
    let conn_id = Uuid::new_v4();
    sqlx::query(
        "insert into connection (id, user_id, provider_key, display_name) \
         values ($1, $2, 'powens', 'Test connection')",
    )
    .bind(conn_id)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();
    conn_id
}

/// Seed a holding for a freshly created user/connection/account/instrument,
/// returning (user_id, holding_id).
pub(crate) async fn seed_holding(pool: &PgPool, email: &str) -> (Uuid, Uuid) {
    use gripsou_core::dto::{CanonicalAccount, CanonicalHolding, InstrumentRef};
    use gripsou_core::repo::account::upsert_account;
    use gripsou_core::repo::holding::upsert_holding;
    use gripsou_core::repo::instrument::resolve_instrument;

    let conn_id = seed_connection(pool, email).await;
    let user_id = gripsou_core::testkit::owner(pool, conn_id).await;

    let mut conn = pool.acquire().await.unwrap();
    let account = CanonicalAccount {
        external_id: "acct-1".into(),
        name: "PEA".into(),
        type_key: "pea".into(),
        currency: "EUR".into(),
        meta: serde_json::json!({}),
        health: None,
        balance_as_of: None,
    };
    let account_id = upsert_account(&mut conn, conn_id, &account).await.unwrap();
    let instrument = InstrumentRef {
        kind: "equity".into(),
        symbol: Some("PAEEM".into()),
        isin: Some("IE00B5BMR087".into()),
        name: "S&P 500".into(),
        currency: "USD".into(),
    };
    let instrument_id = resolve_instrument(&mut conn, &instrument).await.unwrap();
    let holding = CanonicalHolding {
        account_external_id: "acct-1".into(),
        instrument,
        quantity: Decimal::new(100, 0),
        cost_basis: Decimal::new(1000, 0),
        valuation: Some(Decimal::new(1200, 0)),
    };
    let holding_id = upsert_holding(&mut conn, account_id, instrument_id, &holding)
        .await
        .unwrap();
    (user_id, holding_id)
}

pub(crate) fn auth(user_id: Uuid) -> auth::AuthUser {
    auth::AuthUser {
        user_id,
        session_id: Uuid::new_v4(),
    }
}

/// One user's data: their account, their holding (snapshotted today, so it
/// shows in account lists) and one cash transaction described as `label`.
pub(crate) struct Owned {
    pub(crate) user: Uuid,
    pub(crate) account: Uuid,
    pub(crate) holding: Uuid,
}

pub(crate) async fn seed_owned(pool: &PgPool, email: &str, label: &str) -> Owned {
    let (user, holding) = seed_holding(pool, email).await;
    let account: Uuid = sqlx::query_scalar("select account_id from holding where id = $1")
        .bind(holding)
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::query(
        "insert into holding_snapshot (holding_id, as_of, quantity, value) \
         values ($1, current_date, 100, 1200)",
    )
    .bind(holding)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "insert into transaction (account_id, spent_on, type, amount, description) \
         values ($1, current_date, 'deposit', 10, $2)",
    )
    .bind(account)
    .bind(label)
    .execute(pool)
    .await
    .unwrap();
    Owned {
        user,
        account,
        holding,
    }
}

pub(crate) async fn can_login(pool: &PgPool, email: &str, pw: &str) -> bool {
    login_as(pool, &throttles(), local(), email, pw, false)
        .await
        .is_ok()
}

pub(crate) async fn session_alive(pool: &PgPool, id: Uuid) -> bool {
    sqlx::query_scalar::<_, i64>("select count(*) from session where id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
        == 1
}
