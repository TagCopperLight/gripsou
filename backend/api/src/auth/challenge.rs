//! Short-lived, single-use proofs between two requests; each kind has its own state type, stored as JSON.

use serde::Serialize;
use serde::de::DeserializeOwned;
use uuid::Uuid;
use webauthn_rs::prelude::{DiscoverableAuthentication, PasskeyRegistration};

use crate::auth;
use crate::error::ApiError;
use gripsou_core::repo::login_challenge::{self, ChallengeKind};

pub trait Kind: Serialize + DeserializeOwned {
    const KIND: ChallengeKind;
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Mfa {
    pub remember: bool,
}

impl Kind for Mfa {
    const KIND: ChallengeKind = ChallengeKind::Mfa;
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Reauth {}

impl Kind for Reauth {
    const KIND: ChallengeKind = ChallengeKind::Reauth;
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct PasskeyRegister {
    pub reg: PasskeyRegistration,
}

impl Kind for PasskeyRegister {
    const KIND: ChallengeKind = ChallengeKind::PasskeyRegister;
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct PasskeyLogin {
    pub auth: DiscoverableAuthentication,
}

impl Kind for PasskeyLogin {
    const KIND: ChallengeKind = ChallengeKind::PasskeyLogin;
}

pub struct Challenge<K> {
    /// `None` for a passwordless sign-in, which names no account yet.
    pub user_id: Option<Uuid>,
    pub state: K,
}

pub async fn issue<K: Kind>(
    pool: &sqlx::PgPool,
    user_id: Option<Uuid>,
    state: &K,
) -> Result<String, ApiError> {
    let token = auth::generate_token();
    login_challenge::create(
        pool,
        &auth::hash_token(&token),
        user_id,
        K::KIND,
        serde_json::to_value(state)?,
    )
    .await?;
    Ok(token)
}

/// Leaves the challenge unspent.
pub async fn find<K: Kind>(
    pool: &sqlx::PgPool,
    token: &str,
) -> Result<Option<Challenge<K>>, ApiError> {
    login_challenge::find_valid(pool, &auth::hash_token(token), K::KIND)
        .await?
        .map(typed)
        .transpose()
}

/// Of two concurrent callers only one gets it. Works in a caller's transaction too.
pub async fn consume<K: Kind>(
    db: impl sqlx::PgExecutor<'_>,
    token: &str,
) -> Result<Option<Challenge<K>>, ApiError> {
    login_challenge::consume(db, &auth::hash_token(token), K::KIND)
        .await?
        .map(typed)
        .transpose()
}

fn typed<K: Kind>(c: login_challenge::Challenge) -> Result<Challenge<K>, ApiError> {
    Ok(Challenge {
        user_id: c.user_id,
        state: serde_json::from_value(c.state)?,
    })
}

/// Single use: a token belonging to someone else is burnt and refused.
pub async fn spend_reauth(
    db: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
    token: &str,
) -> Result<(), ApiError> {
    match consume::<Reauth>(db, token).await? {
        Some(c) if c.user_id == Some(user_id) => Ok(()),
        _ => Err(ApiError::ReauthRequired),
    }
}

/// `None` before the welcome flow is finished: it offers a second factor without a password, so there is nothing to check or spend.
pub async fn factor_reauth<'a>(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    reauth: Option<&'a str>,
) -> Result<Option<&'a str>, ApiError> {
    if reauth.is_some() {
        return Ok(reauth);
    }
    let profile = gripsou_core::repo::user::profile_by_id(pool, user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    if profile.welcome_done {
        Err(ApiError::ReauthRequired)
    } else {
        Ok(None)
    }
}

/// Does not spend: a ceremony that finishes later does.
pub async fn check_reauth(pool: &sqlx::PgPool, user_id: Uuid, token: &str) -> Result<(), ApiError> {
    match find::<Reauth>(pool, token).await? {
        Some(c) if c.user_id == Some(user_id) => Ok(()),
        _ => Err(ApiError::ReauthRequired),
    }
}
