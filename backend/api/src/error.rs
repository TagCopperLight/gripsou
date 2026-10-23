//! The one error every handler and extractor returns. Each case knows its
//! status; handlers use `?`, and an unexpected error becomes `Internal`.

use axum::http::{HeaderValue, StatusCode, header::RETRY_AFTER};
use axum::response::{IntoResponse, Response};

#[derive(Debug, PartialEq, Eq)]
pub enum ApiError {
    BadRequest(String),
    /// No session, or one that no longer exists. The only 401 besides a
    /// refused login: the client signs out on it.
    Unauthorized,
    InvalidCredentials,
    /// The session is fine but the action needs a fresh password check (a
    /// reauth token), and the one sent is missing, used or someone else's.
    ReauthRequired,
    Forbidden(&'static str),
    NotFound(&'static str),
    Conflict(&'static str),
    /// A login or passkey challenge that is used up or past its 5 minutes.
    ChallengeExpired,
    Unprocessable(&'static str),
    TooMany {
        retry_after: u64,
    },
    BadGateway(String),
    /// Already logged by [`ApiError::internal`].
    Internal,
}

impl ApiError {
    /// The real error goes to the log; the client gets a fixed message.
    /// sqlx/Postgres error strings quote the failing statement and its
    /// parameters, so returning them hands an untrusted caller a view of the
    /// schema and of whatever input reached the query. The request span
    /// supplies the route and request_id.
    pub fn internal(e: impl std::fmt::Display) -> Self {
        tracing::error!(error = %e, "internal error");
        ApiError::Internal
    }

    pub fn bad_request(msg: impl Into<String>) -> Self {
        ApiError::BadRequest(msg.into())
    }

    /// A unique-constraint violation becomes 409 with `msg`; anything else 500.
    pub fn conflict_on_unique(
        msg: &'static str,
    ) -> impl Fn(gripsou_core::error::CoreError) -> Self {
        move |e| match &e {
            gripsou_core::error::CoreError::Db(sqlx::Error::Database(db))
                if db.is_unique_violation() =>
            {
                ApiError::Conflict(msg)
            }
            _ => e.into(),
        }
    }

    pub fn status(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized | ApiError::InvalidCredentials => StatusCode::UNAUTHORIZED,
            ApiError::ReauthRequired | ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::ChallengeExpired => StatusCode::GONE,
            ApiError::Unprocessable(_) => StatusCode::UNPROCESSABLE_ENTITY,
            ApiError::TooMany { .. } => StatusCode::TOO_MANY_REQUESTS,
            ApiError::BadGateway(_) => StatusCode::BAD_GATEWAY,
            ApiError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            ApiError::BadRequest(m) | ApiError::BadGateway(m) => m,
            ApiError::Forbidden(m)
            | ApiError::NotFound(m)
            | ApiError::Conflict(m)
            | ApiError::Unprocessable(m) => m,
            ApiError::Unauthorized => "unauthorized",
            ApiError::InvalidCredentials => "invalid email or password",
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

impl From<crate::throttle::Blocked> for ApiError {
    fn from(blocked: crate::throttle::Blocked) -> Self {
        ApiError::TooMany {
            retry_after: blocked.retry_after_secs(),
        }
    }
}

/// Any other error is ours: logged with its causes, answered 500.
impl<E: std::error::Error + 'static> From<E> for ApiError {
    fn from(e: E) -> Self {
        ApiError::internal(gripsou_core::logs::error_chain(&e))
    }
}
