use axum::extract::FromRequest;
use axum::extract::rejection::JsonRejection;
use axum::http::{HeaderValue, StatusCode, header::RETRY_AFTER};
use axum::response::{IntoResponse, Response};
use gripsou_core::error::CoreError;
use serde::Serialize;

/// Like `axum::Json`, but a body that isn't the expected JSON is a 400 [`ApiError`].
#[derive(Debug, FromRequest)]
#[from_request(via(axum::Json), rejection(ApiError))]
pub struct Json<T>(pub T);

impl<T> std::ops::Deref for Json<T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T: Serialize> IntoResponse for Json<T> {
    fn into_response(self) -> Response {
        axum::Json(self.0).into_response()
    }
}

impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        match rejection {
            JsonRejection::JsonDataError(_) | JsonRejection::JsonSyntaxError(_) => {
                ApiError::BadRequest(rejection.body_text())
            }
            _ => ApiError::Rejected(rejection.status(), rejection.body_text()),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ApiError {
    BadRequest(String),
    /// The only 401 besides a refused login or setup code: the client signs out on it.
    Unauthorized,
    InvalidCredentials,
    WrongSetupCode,
    ReauthRequired,
    Forbidden(&'static str),
    NotFound(&'static str),
    Conflict(&'static str),
    ChallengeExpired,
    Unprocessable(&'static str),
    TooMany {
        retry_after: u64,
    },
    BadGateway(String),
    Rejected(StatusCode, String),
    /// Already logged by [`ApiError::internal`].
    Internal,
}

impl ApiError {
    /// The client gets a fixed message: sqlx errors quote the failing statement and parameters, which would show an untrusted caller the schema and input.
    pub fn internal(e: impl std::fmt::Display) -> Self {
        tracing::error!(error = %e, "internal error");
        ApiError::Internal
    }

    pub fn bad_request(msg: impl Into<String>) -> Self {
        ApiError::BadRequest(msg.into())
    }

    pub fn conflict_on_unique(msg: &'static str) -> impl Fn(CoreError) -> Self {
        move |e| match &e {
            CoreError::Db(sqlx::Error::Database(db)) if db.is_unique_violation() => {
                ApiError::Conflict(msg)
            }
            _ => e.into(),
        }
    }

    pub fn status(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized | ApiError::InvalidCredentials | ApiError::WrongSetupCode => {
                StatusCode::UNAUTHORIZED
            }
            ApiError::ReauthRequired | ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::ChallengeExpired => StatusCode::GONE,
            ApiError::Unprocessable(_) => StatusCode::UNPROCESSABLE_ENTITY,
            ApiError::TooMany { .. } => StatusCode::TOO_MANY_REQUESTS,
            ApiError::BadGateway(_) => StatusCode::BAD_GATEWAY,
            ApiError::Rejected(status, _) => *status,
            ApiError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            ApiError::BadRequest(m) | ApiError::BadGateway(m) | ApiError::Rejected(_, m) => m,
            ApiError::Forbidden(m)
            | ApiError::NotFound(m)
            | ApiError::Conflict(m)
            | ApiError::Unprocessable(m) => m,
            ApiError::Unauthorized => "unauthorized",
            ApiError::InvalidCredentials => "invalid email or password",
            ApiError::WrongSetupCode => "wrong setup code",
            ApiError::ReauthRequired => "reauthentication required",
            ApiError::ChallengeExpired => "challenge expired",
            ApiError::TooMany { .. } => "too many attempts",
            ApiError::Internal => "internal server error",
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut res = (self.status(), self.message().to_string()).into_response();
        if let ApiError::TooMany { retry_after } = self {
            res.headers_mut()
                .insert(RETRY_AFTER, HeaderValue::from(retry_after));
        }
        res
    }
}

impl From<crate::auth::throttle::Blocked> for ApiError {
    fn from(blocked: crate::auth::throttle::Blocked) -> Self {
        ApiError::TooMany {
            retry_after: blocked.retry_after_secs(),
        }
    }
}

impl From<CoreError> for ApiError {
    fn from(e: CoreError) -> Self {
        match e {
            CoreError::NotFound(what) => ApiError::NotFound(what),
            e => ApiError::internal(gripsou_core::logs::error_chain(&e)),
        }
    }
}

macro_rules! internal_errors {
    ($($t:ty),* $(,)?) => {$(
        impl From<$t> for ApiError {
            fn from(e: $t) -> Self {
                ApiError::internal(gripsou_core::logs::error_chain(&e))
            }
        }
    )*};
}

internal_errors!(
    sqlx::Error,
    serde_json::Error,
    gripsou_core::crypto::CryptoError,
    argon2::password_hash::Error,
    qrcode::types::QrError,
    webauthn_rs::prelude::WebauthnError,
);
