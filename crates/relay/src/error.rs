use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;
use uuid::Uuid;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("authentication required")]
    Authentication,
    #[error("operation is forbidden")]
    Forbidden,
    #[error("resource was not found")]
    NotFound,
    #[error("resource state conflicts with this operation")]
    Conflict,
    #[error("device is offline")]
    Offline,
    #[error("request rate exceeded")]
    RateLimited,
    #[error("credential or ticket expired")]
    Expired,
    #[error("configuration error: {0}")]
    Config(String),
    #[error("storage operation failed")]
    Store(#[source] sqlx::Error),
    #[error("serialization failed")]
    Serialize(#[source] serde_json::Error),
    #[error("protocol operation failed")]
    Protocol(#[source] remote_proto::Error),
    #[error("web authentication failed: {0}")]
    Webauthn(String),
    #[error("password verification failed")]
    Password,
    #[error("I/O operation failed")]
    Io(#[source] std::io::Error),
    #[error("internal operation failed: {0}")]
    Internal(String),
}

impl From<sqlx::Error> for Error {
    fn from(error: sqlx::Error) -> Self {
        Self::Store(error)
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::Serialize(error)
    }
}

impl From<remote_proto::Error> for Error {
    fn from(error: remote_proto::Error) -> Self {
        Self::Protocol(error)
    }
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Serialize)]
struct Body {
    code: &'static str,
    retryable: bool,
    detail: String,
}

impl Error {
    fn response(&self) -> (StatusCode, &'static str, bool) {
        match self {
            Self::Invalid(_) => (StatusCode::BAD_REQUEST, "INVALID_REQUEST", false),
            Self::Authentication => (StatusCode::UNAUTHORIZED, "AUTH_REQUIRED", false),
            Self::Forbidden => (StatusCode::FORBIDDEN, "AUTH_FORBIDDEN", false),
            Self::NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND", false),
            Self::Conflict => (StatusCode::CONFLICT, "CONFLICT", false),
            Self::Offline => (StatusCode::CONFLICT, "DEVICE_OFFLINE", true),
            Self::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", true),
            Self::Expired => (StatusCode::GONE, "EXPIRED", false),
            Self::Protocol(_) => (StatusCode::BAD_REQUEST, "PROTOCOL_MISMATCH", false),
            Self::Config(_)
            | Self::Store(_)
            | Self::Serialize(_)
            | Self::Webauthn(_)
            | Self::Password
            | Self::Io(_)
            | Self::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL", true),
        }
    }
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let detail = Uuid::now_v7().to_string();
        let (status, code, retryable) = self.response();
        if status.is_server_error() {
            tracing::error!(%detail, error = %self, "request failed");
        } else {
            tracing::warn!(%detail, error = %self, "request rejected");
        }
        (
            status,
            Json(Body {
                code,
                retryable,
                detail,
            }),
        )
            .into_response()
    }
}
