use std::str::FromStr;

use axum::{
    Json,
    extract::{FromRequestParts, Path, State},
    http::{HeaderMap, header, request::Parts},
};
use remote_proto::id::{DeviceId, UserId};
use serde::Deserialize;

use crate::{
    browser::Principal,
    error::{Error, Result},
    model::{Audit, Device},
    secret,
    state::App,
};

#[derive(Clone, Copy, Debug)]
pub struct Agent {
    pub device: DeviceId,
    pub user: UserId,
}

impl FromRequestParts<App> for Agent {
    type Rejection = Error;

    async fn from_request_parts(parts: &mut Parts, state: &App) -> Result<Self> {
        let value = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Device "))
            .ok_or(Error::Authentication)?;
        let (id, token) = value.split_once('.').ok_or(Error::Authentication)?;
        let device = DeviceId::from_str(id).map_err(|_| Error::Authentication)?;
        let user = state
            .store
            .authenticate_device(device, &secret::hash(token))
            .await?;
        Ok(Self { device, user })
    }
}

pub async fn list(State(app): State<App>, principal: Principal) -> Result<Json<Vec<Device>>> {
    Ok(Json(app.store.devices(principal.user.id).await?))
}

#[derive(Deserialize)]
pub struct Rename {
    name: String,
}

pub async fn rename(
    State(app): State<App>,
    principal: Principal,
    headers: HeaderMap,
    Path(id): Path<DeviceId>,
    Json(request): Json<Rename>,
) -> Result<Json<Device>> {
    principal.csrf(&headers)?;
    validate_name(&request.name)?;
    app.store
        .rename_device(principal.user.id, id, request.name.trim())
        .await?;
    app.store
        .audit(Audit {
            user: Some(principal.user.id),
            actor: "browser",
            kind: "device.rename",
            target: &id.to_string(),
            result: "success",
        })
        .await?;
    Ok(Json(app.store.device(principal.user.id, id).await?))
}

pub async fn revoke(
    State(app): State<App>,
    principal: Principal,
    headers: HeaderMap,
    Path(id): Path<DeviceId>,
) -> Result<Json<serde_json::Value>> {
    principal.csrf(&headers)?;
    app.store.revoke_device(principal.user.id, id).await?;
    app.hub.revoke(id);
    app.store
        .audit(Audit {
            user: Some(principal.user.id),
            actor: "browser",
            kind: "device.revoke",
            target: &id.to_string(),
            result: "success",
        })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn validate_name(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > 100 || value.chars().any(char::is_control)
    {
        return Err(Error::Invalid("device name is invalid".into()));
    }
    Ok(())
}
