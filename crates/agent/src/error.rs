use thiserror::Error;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("credential store error: {0}")]
    Credential(String),
    #[error("pairing failed: {0}")]
    Pair(String),
    #[error("relay request failed")]
    Http(#[from] reqwest::Error),
    #[error("websocket operation failed")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("protocol operation failed")]
    Protocol(#[from] remote_proto::Error),
    #[error("PTY operation failed: {0}")]
    Pty(String),
    #[error("I/O operation failed")]
    Io(#[from] std::io::Error),
    #[error("serialization failed")]
    Serialize(#[from] serde_json::Error),
    #[error("task failed: {0}")]
    Task(String),
    #[error("relay rejected authorization")]
    Authentication,
    #[error("session was not found")]
    NotFound,
}
