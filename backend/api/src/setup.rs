//! First-run setup: while nobody has an account, the server prints a one-time
//! code at startup, and whoever types it in the browser creates the first
//! account, as admin. Once any user exists, setup is closed for good.

use std::sync::Arc;
use std::time::Instant;

use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::State;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::auth::client::Client;
use crate::auth::dto::LoginResponse;
use crate::auth::throttle::Throttles;
use crate::auth::{self, invite, password, session};
use crate::error::{ApiError, Json};
use crate::routes::Routes;
use gripsou_core::error::CoreError;
use gripsou_core::repo::user;

/// Crockford's base32: no I, L, O or U, which read like other characters.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// 60 bits: far beyond what the per-IP limiter lets anyone try.
const CODE_CHARS: usize = 12;
const GROUP_CHARS: usize = 4;

/// The SHA-256 of the code in effect, or nothing once setup is closed. The
/// lock is held for a whole creation, so two requests can't both create the
/// first admin.
pub struct Setup(Mutex<Option<Vec<u8>>>);

impl Setup {
    pub fn closed() -> Self {
        Setup(Mutex::new(None))
    }

    fn open(code: &str) -> Self {
        Setup(Mutex::new(Some(hash_code(code))))
    }
}

/// At startup: while nobody has an account, a new code, printed to the
/// terminal only. Info lines are saved in the `log` table, readable from the
/// app, so the code never goes through `tracing`.
pub async fn start(pool: &PgPool) -> Result<Setup, CoreError> {
    if user::any_exists(pool).await? {
        return Ok(Setup::closed());
    }
    let code = new_code();
    println!("gripsou has no account yet. Open it in a browser and enter this setup code:");
    println!("    {code}");
    tracing::info!("setup code printed");
    Ok(Setup::open(&code))
}

/// Three groups of four, `K7QM-3XRD-9PWF`, from OS randomness.
fn new_code() -> String {
    let bits = OsRng.next_u64();
    let chars: Vec<char> = (0..CODE_CHARS)
        .map(|i| ALPHABET[((bits >> (5 * i)) & 31) as usize] as char)
        .collect();
    chars
        .chunks(GROUP_CHARS)
        .map(|group| group.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-")
}

/// The code as typed, the way Crockford reads it: any case, spaces and
/// dashes ignored, O read as 0, I and L as 1.
fn normalize(code: &str) -> String {
    code.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        })
        .collect()
}

fn hash_code(code: &str) -> Vec<u8> {
    auth::hash_token(&normalize(code))
}

#[derive(Debug, Serialize, TS)]
pub struct SetupStatus {
    pub needed: bool,
}

#[derive(Deserialize, TS)]
pub struct SetupReq {
    pub code: String,
    pub email: String,
    pub name: String,
    pub password: String,
}

pub(crate) fn routes() -> Routes {
    Routes::default()
        .get("/setup", status)
        .post("/setup", create)
}

fn closed() -> ApiError {
    ApiError::NotFound("setup is closed")
}

/// Public: whether the sign-in page should send the visitor to setup.
pub async fn status(
    State(pool): State<PgPool>,
    State(setup): State<Arc<Setup>>,
) -> Result<Json<SetupStatus>, ApiError> {
    let mut slot = setup.0.lock().await;
    // A user made by hand in SQL after startup closes setup too.
    if slot.is_some() && user::any_exists(&pool).await? {
        *slot = None;
    }
    Ok(Json(SetupStatus {
        needed: slot.is_some(),
    }))
}

/// Public: the setup code and the first account's details become that
/// account, as admin, signed in.
pub async fn create(
    State(pool): State<PgPool>,
    State(setup): State<Arc<Setup>>,
    State(throttles): State<Arc<Throttles>>,
    client: Client,
    Json(body): Json<SetupReq>,
) -> Result<Json<LoginResponse>, ApiError> {
    // Before the code, so a typo in the password never counts as a guess.
    let (email, name) = invite::new_account_fields(&body.email, &body.name, &body.password)?;
    let mut slot = setup.0.lock().await;
    let expected = slot.as_deref().ok_or_else(closed)?;
    let attempt = throttles.setup(&client.ip, Instant::now())?;
    // Checked before the password is hashed: no argon2 for a stranger's guesses.
    if !auth::ct_eq(&hash_code(&body.code), expected) {
        tracing::warn!(ip = %client.ip, "setup code refused");
        return Err(ApiError::WrongSetupCode);
    }
    attempt.succeeded();
    let pw_hash = password::hash(&body.password)?;
    let created = user::create_first_admin(&pool, email, name, &pw_hash).await?;
    *slot = None;
    drop(slot);
    let user_id = created.ok_or_else(closed)?;
    tracing::info!(user_id = %user_id, "first admin created");
    let resp = session::issue(&pool, &client, user_id, true).await?;
    Ok(Json(resp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;
    use axum::http::StatusCode;

    const CODE: &str = "K7QM-3XRD-9PWF";

    fn open() -> Arc<Setup> {
        Arc::new(Setup::open(CODE))
    }

    async fn post(
        pool: &PgPool,
        setup: &Arc<Setup>,
        throttles: &Arc<Throttles>,
        code: &str,
    ) -> Result<Json<LoginResponse>, ApiError> {
        create(
            State(pool.clone()),
            State(setup.clone()),
            State(throttles.clone()),
            local(),
            Json(SetupReq {
                code: code.into(),
                email: "admin@t.local".into(),
                name: "Admin".into(),
                password: "hunter2-long".into(),
            }),
        )
        .await
    }

    async fn needed(pool: &PgPool, setup: &Arc<Setup>) -> bool {
        status(State(pool.clone()), State(setup.clone()))
            .await
            .unwrap()
            .0
            .needed
    }

    async fn users(pool: &PgPool) -> i64 {
        sqlx::query_scalar("select count(*) from users")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[test]
    fn codes_are_three_groups_of_four_and_read_forgivingly() {
        let code = new_code();
        assert_eq!(code.len(), 14, "{code}");
        assert!(code.split('-').all(|g| g.len() == 4), "{code}");
        assert!(
            normalize(&code).bytes().all(|b| ALPHABET.contains(&b)),
            "{code}"
        );
        assert_ne!(new_code(), code);
        assert_eq!(normalize(" k7qm 3xrd-9pwf "), normalize(CODE));
        assert_eq!(normalize("O1L-I"), "0111");
    }

    #[gripsou_core::testkit::db_test]
    async fn the_right_code_creates_the_admin_once(pool: PgPool) {
        let setup = open();
        let throttles = throttles();
        assert!(needed(&pool, &setup).await);

        let err = post(&pool, &setup, &throttles, "AAAA-BBBB-CCCC")
            .await
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(users(&pool).await, 0);

        let resp = post(&pool, &setup, &throttles, "k7qm 3xrd 9pwf")
            .await
            .expect("setup ok")
            .0;
        assert_eq!(resp.user.role, Role::Admin);
        assert!(!resp.user.welcome_done);
        assert!(
            gripsou_core::repo::session::find_valid_by_hash(&pool, &auth::hash_token(&resp.token))
                .await
                .unwrap()
                .is_some(),
            "the answer signs the admin in"
        );
        assert!(!needed(&pool, &setup).await);

        let again = post(&pool, &setup, &throttles, CODE).await.unwrap_err();
        assert_eq!(again.status(), StatusCode::NOT_FOUND);
        assert_eq!(users(&pool).await, 1);
    }

    #[gripsou_core::testkit::db_test]
    async fn a_user_made_after_startup_closes_setup(pool: PgPool) {
        let setup = open();
        seed_user(&pool, "by-hand@t.local").await;
        assert!(!needed(&pool, &setup).await);
        let err = post(&pool, &setup, &throttles(), CODE).await.unwrap_err();
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert_eq!(users(&pool).await, 1);
    }

    /// Without the GET clearing the slot first, the insert itself refuses.
    #[gripsou_core::testkit::db_test]
    async fn the_insert_refuses_when_a_user_exists(pool: PgPool) {
        let setup = open();
        seed_user(&pool, "by-hand@t.local").await;
        let err = post(&pool, &setup, &throttles(), CODE).await.unwrap_err();
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
        assert_eq!(users(&pool).await, 1);
        assert!(!needed(&pool, &setup).await);
    }

    #[gripsou_core::testkit::db_test]
    async fn two_requests_at_once_create_one_admin(pool: PgPool) {
        let setup = open();
        let throttles = throttles();
        let (a, b) = tokio::join!(
            post(&pool, &setup, &throttles, CODE),
            post(&pool, &setup, &throttles, CODE),
        );
        assert_eq!(a.is_ok() as u8 + b.is_ok() as u8, 1);
        assert_eq!(users(&pool).await, 1);
    }

    #[gripsou_core::testkit::db_test]
    async fn the_31st_wrong_code_from_one_ip_waits(pool: PgPool) {
        let setup = open();
        let throttles = throttles();
        for _ in 0..30 {
            let err = post(&pool, &setup, &throttles, "AAAA-BBBB-CCCC")
                .await
                .unwrap_err();
            assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
        }
        let err = post(&pool, &setup, &throttles, CODE).await.unwrap_err();
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(users(&pool).await, 0);
    }

    #[gripsou_core::testkit::db_test]
    async fn a_bad_password_is_not_a_guess(pool: PgPool) {
        let setup = open();
        let err = create(
            State(pool.clone()),
            State(setup.clone()),
            State(throttles()),
            local(),
            Json(SetupReq {
                code: CODE.into(),
                email: "admin@t.local".into(),
                name: "Admin".into(),
                password: "short".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert!(needed(&pool, &setup).await);
    }

    #[gripsou_core::testkit::db_test]
    async fn the_code_never_reaches_the_saved_log(pool: PgPool) {
        let (_g, mut writer) = gripsou_core::logs::capture(1000);
        let started = start(&pool).await.unwrap();
        assert!(started.0.lock().await.is_some());
        let setup = open();
        let throttles = throttles();
        let _ = post(&pool, &setup, &throttles, "AAAA-BBBB-CCCC").await;
        post(&pool, &setup, &throttles, CODE).await.unwrap();
        writer.flush(&pool).await;

        let lines: Vec<(String, serde_json::Value)> =
            sqlx::query_as("select message, fields from log order by id")
                .fetch_all(&pool)
                .await
                .unwrap();
        let messages: Vec<&str> = lines.iter().map(|(m, _)| m.as_str()).collect();
        for expected in [
            "setup code printed",
            "setup code refused",
            "first admin created",
        ] {
            assert!(messages.contains(&expected), "{messages:?}");
        }
        let saved = format!("{lines:?}");
        for secret in [
            CODE,
            normalize(CODE).as_str(),
            "AAAA-BBBB-CCCC",
            "AAAABBBBCCCC",
        ] {
            assert!(!saved.contains(secret), "{saved}");
        }
        let printed = &lines
            .iter()
            .find(|(m, _)| m == "setup code printed")
            .unwrap()
            .1;
        assert_eq!(printed, &serde_json::json!({}));
    }

    #[gripsou_core::testkit::db_test]
    async fn startup_opens_setup_only_on_an_empty_database(pool: PgPool) {
        assert!(start(&pool).await.unwrap().0.lock().await.is_some());
        seed_user(&pool, "a@t.local").await;
        assert!(start(&pool).await.unwrap().0.lock().await.is_none());
    }
}
