use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use remote_proto::id::DeviceId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    browser::Principal,
    error::{Error, Result},
    model::{Audit, DeviceFlow, FlowState, now},
    secret,
    state::App,
    store::FlowGrant,
};

const EXPIRES: i64 = 600;
const INTERVAL: i64 = 5;

#[derive(Deserialize)]
pub struct Start {
    name: String,
    platform: String,
    version: String,
    fingerprint: String,
}

#[derive(Serialize)]
pub struct Started {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: String,
    expires_in: i64,
    interval: i64,
}

pub async fn start(State(app): State<App>, Json(request): Json<Start>) -> Result<Json<Started>> {
    validate(&request.name, 100)?;
    validate(&request.platform, 64)?;
    validate(&request.version, 64)?;
    validate(&request.fingerprint, 128)?;
    let device_code = secret::token();
    let user_code = secret::short();
    let flow = DeviceFlow {
        id: Uuid::now_v7(),
        user_code: user_code.clone(),
        name: request.name,
        platform: request.platform,
        version: request.version,
        fingerprint: request.fingerprint,
        expires_at: now() + EXPIRES,
        interval_secs: INTERVAL,
        last_poll_at: None,
        state: FlowState::Pending,
        user: None,
    };
    app.store
        .create_flow(&flow, &secret::hash(&device_code))
        .await?;
    let verification = app
        .config
        .public_url
        .join("/pair")
        .map_err(|error| Error::Config(error.to_string()))?;
    let mut complete = verification.clone();
    complete
        .query_pairs_mut()
        .append_pair("user_code", &user_code);
    Ok(Json(Started {
        device_code,
        user_code,
        verification_uri: verification.to_string(),
        verification_uri_complete: complete.to_string(),
        expires_in: EXPIRES,
        interval: INTERVAL,
    }))
}

#[derive(Deserialize)]
pub struct Code {
    user_code: String,
}

#[derive(Serialize)]
pub struct Review {
    user_code: String,
    name: String,
    platform: String,
    version: String,
    fingerprint: String,
    expires_at: i64,
}

pub async fn review(
    State(app): State<App>,
    _principal: Principal,
    Json(request): Json<Code>,
) -> Result<Json<Review>> {
    let flow = app
        .store
        .flow_by_code(&normalize(&request.user_code))
        .await?;
    if flow.expires_at <= now() || flow.state != FlowState::Pending {
        return Err(Error::Expired);
    }
    Ok(Json(view(flow)))
}

pub async fn authorize(
    State(app): State<App>,
    principal: Principal,
    headers: HeaderMap,
    Json(request): Json<Code>,
) -> Result<Json<Review>> {
    principal.csrf(&headers)?;
    let flow = app
        .store
        .authorize_flow(principal.user.id, &normalize(&request.user_code))
        .await?;
    app.store
        .audit(Audit {
            user: Some(principal.user.id),
            actor: "browser",
            kind: "device.authorize",
            target: &flow.fingerprint,
            result: "success",
        })
        .await?;
    Ok(Json(view(flow)))
}

#[derive(Deserialize)]
pub struct Token {
    device_code: String,
}

#[derive(Serialize)]
pub struct Granted {
    token_type: &'static str,
    device_id: DeviceId,
    device_token: String,
}

#[derive(Serialize)]
pub struct OAuthError {
    error: &'static str,
}

pub async fn token(State(app): State<App>, Json(request): Json<Token>) -> Result<Response> {
    let device_hash = secret::hash(&request.device_code);
    let flow = match app.store.poll_flow(&device_hash).await {
        Ok(flow) => flow,
        Err(Error::RateLimited) => return Ok(oauth("slow_down")),
        Err(Error::Expired) => return Ok(oauth("expired_token")),
        Err(error) => return Err(error),
    };
    match flow.state {
        FlowState::Pending => Ok(oauth("authorization_pending")),
        FlowState::Denied => Ok(oauth("access_denied")),
        FlowState::Consumed => Ok(oauth("expired_token")),
        FlowState::Approved => {
            let device_token = secret::token();
            let (device_id, user) = app
                .store
                .grant_flow(FlowGrant {
                    device_hash: &device_hash,
                    token_hash: &secret::hash(&device_token),
                })
                .await?;
            app.store
                .audit(Audit {
                    user: Some(user),
                    actor: "agent",
                    kind: "device.pair",
                    target: &device_id.to_string(),
                    result: "success",
                })
                .await?;
            Ok((
                StatusCode::OK,
                Json(Granted {
                    token_type: "Device",
                    device_id,
                    device_token,
                }),
            )
                .into_response())
        }
    }
}

fn oauth(error: &'static str) -> Response {
    (StatusCode::BAD_REQUEST, Json(OAuthError { error })).into_response()
}

fn view(flow: DeviceFlow) -> Review {
    Review {
        user_code: flow.user_code,
        name: flow.name,
        platform: flow.platform,
        version: flow.version,
        fingerprint: flow.fingerprint,
        expires_at: flow.expires_at,
    }
}

fn normalize(code: &str) -> String {
    let mut canonical = String::with_capacity(17);
    for character in code.trim().chars() {
        if character != '-' && !character.is_ascii_whitespace() {
            canonical.push(character.to_ascii_uppercase());
        }
    }
    if canonical.is_ascii() && canonical.len() == 16 {
        canonical.insert(8, '-');
    }
    canonical
}

fn validate(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > max || value.chars().any(char::is_control)
    {
        return Err(Error::Invalid("pairing metadata is invalid".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn normalizes_user_code() {
        let canonical = "L5YU7CTF-DJFR3HRU";
        assert_eq!(normalize(canonical), canonical);
        assert_eq!(normalize("l5yu7ctfdjfr3hru"), canonical);
        assert_eq!(normalize("  l5yu7ctf djfr3hru  "), canonical);
    }
}
