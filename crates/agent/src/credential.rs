use std::path::{Path, PathBuf};

use remote_proto::id::DeviceId;
use secrecy::{ExposeSecret, SecretString};
use tokio::{fs, task};
use zeroize::Zeroizing;

use crate::{
    config::Config,
    error::{Error, Result},
};

const SERVICE: &str = "remote-terminal";

pub struct Credential(SecretString);

impl Credential {
    pub async fn save(device: DeviceId, token: String, fallback: &Path) -> Result<Option<PathBuf>> {
        let user = device.to_string();
        let keyring_token = token.clone();
        let stored = task::spawn_blocking(move || {
            let entry = keyring::Entry::new(SERVICE, &user)?;
            entry.set_password(&keyring_token)
        })
        .await
        .map_err(|error| Error::Task(error.to_string()))?;
        if stored.is_ok() {
            return Ok(None);
        }
        if let Some(parent) = fallback.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(fallback, token.as_bytes()).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(fallback, std::fs::Permissions::from_mode(0o600)).await?;
        }
        tracing::warn!(path = %fallback.display(), "OS keyring unavailable; using protected token file");
        Ok(Some(fallback.to_path_buf()))
    }

    pub async fn load(config: &Config) -> Result<Self> {
        let user = config.device.to_string();
        let keyring = task::spawn_blocking(move || {
            let entry = keyring::Entry::new(SERVICE, &user)?;
            entry.get_password()
        })
        .await
        .map_err(|error| Error::Task(error.to_string()))?;
        match keyring {
            Ok(token) => Ok(Self(SecretString::from(token))),
            Err(error) => {
                let path = config.token_file.as_ref().ok_or_else(|| {
                    Error::Credential(format!(
                        "keyring unavailable and no token file is configured: {error}"
                    ))
                })?;
                validate_mode(path).await?;
                let token = Zeroizing::new(fs::read_to_string(path).await?);
                let token = token.trim().to_owned();
                if token.is_empty() {
                    return Err(Error::Credential("token file is empty".into()));
                }
                Ok(Self(SecretString::from(token)))
            }
        }
    }

    #[must_use]
    pub fn expose(&self) -> &str {
        self.0.expose_secret()
    }
}

async fn validate_mode(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path).await?.permissions().mode();
        if mode & 0o077 != 0 {
            return Err(Error::Credential(format!(
                "token file {} must not be accessible by group or others",
                path.display()
            )));
        }
    }
    Ok(())
}
