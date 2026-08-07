use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

use figment::{
    Figment,
    providers::{Env, Format, Toml},
};
use remote_proto::{id::DeviceId, wire};
use serde::{Deserialize, Serialize};
use tokio::fs;
use url::Url;

use crate::error::{Error, Result};

const MIN_JOURNAL: usize = 1024 * 1024;
const MAX_JOURNAL: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Config {
    pub relay: Url,
    pub device: DeviceId,
    pub name: String,
    pub fingerprint: String,
    pub journal_bytes: usize,
    pub token_file: Option<PathBuf>,
    pub profiles: Vec<Profile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub shell: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: PathBuf,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let config: Self = Figment::new()
            .merge(Toml::file(path))
            .merge(Env::prefixed("RT_AGENT_").split("__"))
            .extract()
            .map_err(|error| Error::Config(error.to_string()))?;
        config.validate()?;
        Ok(config)
    }

    pub async fn save(&self, path: &Path) -> Result<()> {
        self.validate()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }
        let body =
            toml::to_string_pretty(self).map_err(|error| Error::Config(error.to_string()))?;
        fs::write(path, body).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
        }
        Ok(())
    }

    pub fn paired(
        relay: Url,
        device: DeviceId,
        name: String,
        fingerprint: String,
        token_file: Option<PathBuf>,
    ) -> Result<Self> {
        let config = Self {
            relay,
            device,
            name,
            fingerprint,
            journal_bytes: 8 * 1024 * 1024,
            token_file,
            profiles: vec![Profile::default_shell()?],
        };
        config.validate()?;
        Ok(config)
    }

    pub fn profile(&self, id: &str) -> Result<&Profile> {
        self.profiles
            .iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| Error::Config(format!("profile {id} does not exist")))
    }

    #[must_use]
    pub fn public_profiles(&self) -> Vec<wire::Profile> {
        self.profiles.iter().map(Profile::public).collect()
    }

    pub fn websocket(&self, path: &str) -> Result<Url> {
        let mut url = self
            .relay
            .join(path)
            .map_err(|error| Error::Config(error.to_string()))?;
        let scheme = match url.scheme() {
            "https" => "wss",
            "http" => "ws",
            _ => return Err(Error::Config("relay must use HTTP or HTTPS".into())),
        };
        url.set_scheme(scheme)
            .map_err(|_| Error::Config("failed to set websocket scheme".into()))?;
        Ok(url)
    }

    fn validate(&self) -> Result<()> {
        let host = self
            .relay
            .host_str()
            .ok_or_else(|| Error::Config("relay URL must have a host".into()))?;
        if self.relay.scheme() == "http" && !matches!(host, "localhost" | "127.0.0.1" | "::1") {
            return Err(Error::Config("non-local relays must use HTTPS".into()));
        }
        if !matches!(self.relay.scheme(), "http" | "https") {
            return Err(Error::Config("relay URL must use HTTP or HTTPS".into()));
        }
        if !(MIN_JOURNAL..=MAX_JOURNAL).contains(&self.journal_bytes) {
            return Err(Error::Config(
                "journal_bytes must be between 1 and 64 MiB".into(),
            ));
        }
        if self.name.trim().is_empty() || self.fingerprint.trim().is_empty() {
            return Err(Error::Config(
                "device name and fingerprint are required".into(),
            ));
        }
        if self.profiles.is_empty() {
            return Err(Error::Config("at least one profile is required".into()));
        }
        let mut ids = HashSet::new();
        for profile in &self.profiles {
            profile.validate()?;
            if !ids.insert(profile.id.as_str()) {
                return Err(Error::Config(format!("duplicate profile {}", profile.id)));
            }
        }
        Ok(())
    }
}

impl Profile {
    pub fn default_shell() -> Result<Self> {
        #[cfg(windows)]
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into());
        #[cfg(not(windows))]
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let cwd = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let profile = Self {
            id: "default".into(),
            name: "Default shell".into(),
            shell,
            args: Vec::new(),
            cwd,
            env: BTreeMap::new(),
        };
        profile.validate()?;
        Ok(profile)
    }

    #[must_use]
    pub fn public(&self) -> wire::Profile {
        wire::Profile {
            id: self.id.clone(),
            name: self.name.clone(),
            shell: self.shell.clone(),
            cwd: self.cwd.to_string_lossy().into_owned(),
        }
    }

    fn validate(&self) -> Result<()> {
        if self.id.is_empty()
            || self.id.len() > 64
            || !self
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(Error::Config("profile ID is invalid".into()));
        }
        if self.name.trim().is_empty() || self.shell.trim().is_empty() {
            return Err(Error::Config(format!("profile {} is incomplete", self.id)));
        }
        if !self.cwd.is_dir() {
            return Err(Error::Config(format!(
                "profile {} cwd does not exist",
                self.id
            )));
        }
        if self
            .env
            .iter()
            .any(|(key, value)| key.is_empty() || key.contains('=') || value.contains('\0'))
        {
            return Err(Error::Config(format!(
                "profile {} has invalid environment",
                self.id
            )));
        }
        Ok(())
    }
}
