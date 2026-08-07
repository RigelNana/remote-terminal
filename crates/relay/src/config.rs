use std::{net::SocketAddr, path::Path};

use figment::{
    Figment,
    providers::{Env, Format, Serialized, Toml},
};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{Error, Result};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Config {
    pub bind: SocketAddr,
    pub database: String,
    pub origin: Url,
    pub public_url: Url,
    pub rp_id: String,
    pub rp_name: String,
    pub cookie_secure: bool,
    pub session_hours: i64,
    pub ticket_seconds: i64,
    pub body_limit: usize,
    pub queue: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            bind: SocketAddr::from(([127, 0, 0, 1], 8080)),
            database: "sqlite://remote-terminal.db".into(),
            origin: Url::parse("http://localhost:8080").expect("static origin is valid"),
            public_url: Url::parse("http://localhost:8080").expect("static public URL is valid"),
            rp_id: "localhost".into(),
            rp_name: "Remote Terminal".into(),
            cookie_secure: false,
            session_hours: 12,
            ticket_seconds: 30,
            body_limit: 64 * 1024,
            queue: 256,
        }
    }
}

impl Config {
    pub fn load(path: Option<&Path>) -> Result<Self> {
        let mut figment = Figment::from(Serialized::defaults(Self::default()));
        if let Some(path) = path {
            figment = figment.merge(Toml::file(path));
        }
        let config: Self = figment
            .merge(Env::prefixed("RT_").split("__"))
            .extract()
            .map_err(|error| Error::Config(error.to_string()))?;
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<()> {
        let origin_host = self
            .origin
            .host_str()
            .ok_or_else(|| Error::Config("origin must have a host".into()))?;
        if self.origin.path() != "/" || self.origin.query().is_some() {
            return Err(Error::Config(
                "origin must not contain a path or query".into(),
            ));
        }
        if origin_host != self.rp_id && !origin_host.ends_with(&format!(".{}", self.rp_id)) {
            return Err(Error::Config(
                "rp_id must equal or contain the origin host".into(),
            ));
        }
        if self.cookie_secure && self.origin.scheme() != "https" {
            return Err(Error::Config(
                "secure cookies require an HTTPS origin".into(),
            ));
        }
        if !self.cookie_secure && self.origin.scheme() != "http" {
            return Err(Error::Config(
                "HTTPS origins must enable secure cookies".into(),
            ));
        }
        if !matches!(self.public_url.scheme(), "http" | "https") {
            return Err(Error::Config("public_url must use http or https".into()));
        }
        if self.session_hours <= 0 || self.ticket_seconds <= 0 || self.queue < 8 {
            return Err(Error::Config(
                "durations must be positive and queue must be at least 8".into(),
            ));
        }
        Ok(())
    }

    #[must_use]
    pub fn websocket_url(&self, path: &str) -> Url {
        let mut url = self
            .public_url
            .join(path)
            .unwrap_or_else(|_| self.public_url.clone());
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        let _ = url.set_scheme(scheme);
        url
    }
}
