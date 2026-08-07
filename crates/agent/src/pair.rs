use std::{path::Path, time::Duration};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use remote_proto::id::DeviceId;
use serde::{Deserialize, Serialize};
use tokio::{fs, time};
use url::Url;

use crate::{
    config::Config,
    credential::Credential,
    error::{Error, Result},
};

#[derive(Serialize)]
struct Start<'a> {
    name: &'a str,
    platform: &'a str,
    version: &'a str,
    fingerprint: &'a str,
}

#[derive(Deserialize)]
struct Started {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: String,
    expires_in: i64,
    interval: i64,
}

#[derive(Serialize)]
struct Token<'a> {
    device_code: &'a str,
}

#[derive(Deserialize)]
struct Granted {
    token_type: String,
    device_id: DeviceId,
    device_token: String,
}

#[derive(Deserialize)]
struct OAuthError {
    error: String,
}

pub async fn run(relay: Url, name: String, path: &Path, force: bool) -> Result<()> {
    if fs::try_exists(path).await? && !force {
        return Err(Error::Config(format!(
            "configuration {} already exists; pass --force to replace it",
            path.display()
        )));
    }
    validate_relay(&relay)?;
    let fingerprint = fingerprint();
    let client = reqwest::Client::builder()
        .user_agent(format!("remote-agent/{}", env!("CARGO_PKG_VERSION")))
        .build()?;
    let start_url = relay
        .join("/v1/pair/device")
        .map_err(|error| Error::Config(error.to_string()))?;
    let response = client
        .post(start_url)
        .json(&Start {
            name: &name,
            platform: std::env::consts::OS,
            version: env!("CARGO_PKG_VERSION"),
            fingerprint: &fingerprint,
        })
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(Error::Pair(format!(
            "relay returned {} while starting device authorization",
            response.status()
        )));
    }
    let started: Started = response.json().await?;
    println!("Open this URL and authorize the device:");
    println!("{}", started.verification_uri_complete);
    println!("User code: {}", started.user_code);
    println!("Verification page: {}", started.verification_uri);
    let token_url = relay
        .join("/v1/pair/token")
        .map_err(|error| Error::Config(error.to_string()))?;
    let deadline = time::Instant::now()
        + Duration::from_secs(u64::try_from(started.expires_in).unwrap_or(600));
    let mut interval = u64::try_from(started.interval).unwrap_or(5).max(1);
    loop {
        if time::Instant::now() >= deadline {
            return Err(Error::Pair("device authorization expired".into()));
        }
        time::sleep(Duration::from_secs(interval)).await;
        let response = client
            .post(token_url.clone())
            .json(&Token {
                device_code: &started.device_code,
            })
            .send()
            .await?;
        if response.status().is_success() {
            let grant: Granted = response.json().await?;
            if grant.token_type != "Device" {
                return Err(Error::Pair(
                    "relay returned an unsupported token type".into(),
                ));
            }
            let fallback = path.with_extension("token");
            let token_file =
                Credential::save(grant.device_id, grant.device_token, &fallback).await?;
            let config = Config::paired(relay, grant.device_id, name, fingerprint, token_file)?;
            config.save(path).await?;
            println!(
                "Paired device {} and wrote {}",
                grant.device_id,
                path.display()
            );
            return Ok(());
        }
        if response.status().as_u16() != 400 {
            return Err(Error::Pair(format!(
                "relay returned {} while polling authorization",
                response.status()
            )));
        }
        let error: OAuthError = response.json().await?;
        match error.error.as_str() {
            "authorization_pending" => {}
            "slow_down" => interval = interval.saturating_add(5),
            "access_denied" => return Err(Error::Pair("device authorization was denied".into())),
            "expired_token" => return Err(Error::Pair("device authorization expired".into())),
            other => return Err(Error::Pair(format!("device authorization failed: {other}"))),
        }
    }
}

fn fingerprint() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 18]>())
}

fn validate_relay(relay: &Url) -> Result<()> {
    let host = relay
        .host_str()
        .ok_or_else(|| Error::Config("relay URL must have a host".into()))?;
    if relay.scheme() == "http" && !matches!(host, "localhost" | "127.0.0.1" | "::1") {
        return Err(Error::Config("non-local relays must use HTTPS".into()));
    }
    if !matches!(relay.scheme(), "http" | "https") {
        return Err(Error::Config("relay URL must use HTTP or HTTPS".into()));
    }
    Ok(())
}
