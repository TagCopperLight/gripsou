//! What the sign-in, account and second-factor endpoints send and accept.

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginReq {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub remember: bool,
}

/// The authenticated user's own profile (no `isSelf`/`joinedAt` — that's the
/// admin user-list shape). Returned by login.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: gripsou_core::repo::user::Role,
    pub prefs: gripsou_core::repo::prefs::UserPrefs,
    pub welcome_done: bool,
}

impl SessionUser {
    pub fn from_profile(p: &gripsou_core::repo::user::UserProfile) -> Self {
        SessionUser {
            id: p.id.to_string(),
            name: p.name.clone(),
            email: p.email.clone(),
            role: p.role,
            prefs: p.prefs.clone(),
            welcome_done: p.welcome_done,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    pub id: String,
    /// Friendly device label parsed from the stored User-Agent.
    pub device: String,
    pub ip: Option<String>,
    pub created_at: i64,
    pub last_active_at: i64,
    pub remembered: bool,
    /// True for the session making this request (UI marks it "This device").
    pub current: bool,
}

impl SessionDto {
    pub fn from_row(s: gripsou_core::repo::session::Session, current_id: uuid::Uuid) -> Self {
        SessionDto {
            current: s.id == current_id,
            id: s.id.to_string(),
            device: s
                .user_agent
                .as_deref()
                .map(crate::auth::client::device_name)
                .unwrap_or_else(|| "Unknown device".to_string()),
            ip: s.ip,
            created_at: s.created_at.timestamp_millis(),
            last_active_at: s.last_active_at.timestamp_millis(),
            remembered: s.remembered,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: SessionUser,
}

/// What `/auth/login` answers: a session, or (second factor enrolled) a
/// short-lived challenge to turn into one at `/auth/login/verify`.
#[derive(Debug, Serialize)]
#[serde(untagged)]
// Built once per login and serialized at once: boxing would only add noise.
#[allow(clippy::large_enum_variant)]
pub enum LoginOutcome {
    Session(LoginResponse),
    Mfa(MfaRequired),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaRequired {
    /// Always true; lets the client tell this shape from a session.
    pub mfa_required: bool,
    pub challenge: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginVerifyReq {
    pub challenge: String,
    pub totp: Option<String>,
    pub recovery_code: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileReq {
    pub name: String,
    pub email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordReq {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAccountReq {
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct TokenInfoResp {
    #[serde(rename = "type")]
    pub token_type: gripsou_core::repo::invite_token::TokenKind,
    pub email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedeemInviteReq {
    pub email: String,
    pub name: String,
    pub password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedeemResetReq {
    pub password: String,
}

#[derive(Deserialize)]
pub struct ReauthReq {
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct ReauthResponse {
    pub reauth: String,
}

#[derive(Deserialize)]
pub struct ReauthTokenReq {
    pub reauth: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaStatus {
    pub totp: bool,
    pub recovery_remaining: i64,
    pub passkeys: Vec<PasskeyInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyInfo {
    pub id: uuid::Uuid,
    pub name: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

impl From<gripsou_core::repo::passkey::PasskeyRow> for PasskeyInfo {
    fn from(r: gripsou_core::repo::passkey::PasskeyRow) -> Self {
        PasskeyInfo {
            id: r.id,
            name: r.name,
            created_at: r.created_at.timestamp_millis(),
            last_used_at: r.last_used_at.map(|t| t.timestamp_millis()),
        }
    }
}

/// A WebAuthn ceremony to run in the browser: `options` is the
/// `publicKey` member, as `@simplewebauthn/browser` takes it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyOptions {
    pub challenge: String,
    pub options: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyRegisterReq {
    pub reauth: String,
    pub challenge: String,
    pub credential: webauthn_rs::prelude::RegisterPublicKeyCredential,
}

#[derive(Deserialize)]
pub struct RenamePasskeyReq {
    pub name: String,
}

/// Finish a passwordless sign-in.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeySignInReq {
    pub challenge: String,
    pub credential: webauthn_rs::prelude::PublicKeyCredential,
    #[serde(default)]
    pub remember: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpSetup {
    pub secret: String,
    pub qr_svg: String,
}

#[derive(Deserialize)]
pub struct TotpConfirmReq {
    pub code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCodes {
    pub recovery_codes: Vec<String>,
}
