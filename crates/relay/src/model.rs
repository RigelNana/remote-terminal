use std::{fmt, str::FromStr};

use remote_proto::{
    id::{DeviceId, EventId, SessionId, UserId},
    wire::Profile,
};
use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;
use webauthn_rs::prelude::Passkey;

use crate::error::{Error, Result};

#[derive(Clone, Debug)]
pub struct User {
    pub id: UserId,
    pub username: String,
    pub display_name: String,
}

#[derive(Clone, Debug)]
pub struct Credential {
    pub id: Uuid,
    pub user: UserId,
    pub name: String,
    pub passkey: Passkey,
}

#[derive(Clone, Debug)]
pub struct Browser {
    pub id: Uuid,
    pub user: User,
    pub csrf_hash: String,
    pub expires_at: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceState {
    Online,
    Degraded,
    Offline,
    Revoked,
}

impl DeviceState {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Online => "online",
            Self::Degraded => "degraded",
            Self::Offline => "offline",
            Self::Revoked => "revoked",
        }
    }
}

impl FromStr for DeviceState {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "online" => Ok(Self::Online),
            "degraded" => Ok(Self::Degraded),
            "offline" => Ok(Self::Offline),
            "revoked" => Ok(Self::Revoked),
            _ => Err(Error::Internal("invalid device state in store".into())),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Device {
    pub id: DeviceId,
    pub name: String,
    pub platform: String,
    pub version: String,
    pub fingerprint: String,
    pub profiles: Vec<Profile>,
    pub state: DeviceState,
    pub created_at: i64,
    pub last_seen_at: Option<i64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Starting,
    Running,
    Exited,
    Lost,
}

impl SessionState {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Exited => "exited",
            Self::Lost => "lost",
        }
    }
}

impl FromStr for SessionState {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "starting" => Ok(Self::Starting),
            "running" => Ok(Self::Running),
            "exited" => Ok(Self::Exited),
            "lost" => Ok(Self::Lost),
            _ => Err(Error::Internal("invalid session state in store".into())),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Session {
    pub id: SessionId,
    pub device: DeviceId,
    pub profile: String,
    pub cwd: String,
    pub state: SessionState,
    pub pid: Option<u32>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub exit_code: Option<i32>,
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FlowState {
    Pending,
    Approved,
    Denied,
    Consumed,
}

impl FlowState {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Denied => "denied",
            Self::Consumed => "consumed",
        }
    }
}

impl FromStr for FlowState {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "approved" => Ok(Self::Approved),
            "denied" => Ok(Self::Denied),
            "consumed" => Ok(Self::Consumed),
            _ => Err(Error::Internal("invalid device flow state in store".into())),
        }
    }
}

#[derive(Clone, Debug)]
pub struct DeviceFlow {
    pub id: Uuid,
    pub user_code: String,
    pub name: String,
    pub platform: String,
    pub version: String,
    pub fingerprint: String,
    pub expires_at: i64,
    pub interval_secs: i64,
    pub last_poll_at: Option<i64>,
    pub state: FlowState,
    pub user: Option<UserId>,
}

#[derive(Clone, Debug)]
pub struct Audit<'a> {
    pub user: Option<UserId>,
    pub actor: &'a str,
    pub kind: &'a str,
    pub target: &'a str,
    pub result: &'a str,
}
#[derive(Clone, Debug, Serialize)]
pub struct AuditEvent {
    pub id: EventId,
    pub actor: String,
    pub kind: String,
    pub target: String,
    pub result: String,
    pub occurred_at: i64,
}

#[must_use]
pub fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}

pub fn uuid(value: &str) -> Result<Uuid> {
    Uuid::parse_str(value).map_err(|_| Error::Internal("invalid UUID in store".into()))
}

pub fn user(value: &str) -> Result<UserId> {
    UserId::from_str(value).map_err(|_| Error::Internal("invalid user ID in store".into()))
}

pub fn device(value: &str) -> Result<DeviceId> {
    DeviceId::from_str(value).map_err(|_| Error::Internal("invalid device ID in store".into()))
}

pub fn session(value: &str) -> Result<SessionId> {
    SessionId::from_str(value).map_err(|_| Error::Internal("invalid session ID in store".into()))
}

impl fmt::Display for FlowState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}
