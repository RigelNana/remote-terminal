use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, header},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use webauthn_rs::prelude::{
    CreationChallengeResponse, PublicKeyCredential, RegisterPublicKeyCredential,
    RequestChallengeResponse,
};

use crate::{
    auth::UserView,
    browser::{Principal, SessionCookies},
    error::Result,
    model::Audit,
    state::App,
};

#[derive(Deserialize)]
pub struct RegisterStart {
    bootstrap: String,
    username: String,
    display_name: String,
    credential_name: String,
}

#[derive(Serialize)]
pub struct RegisterOptions {
    ceremony: Uuid,
    public_key: CreationChallengeResponse,
}

pub async fn register_start(
    State(app): State<App>,
    Json(request): Json<RegisterStart>,
) -> Result<Json<RegisterOptions>> {
    let registration = app
        .auth
        .begin_registration(
            &app.store,
            &request.bootstrap,
            request.username,
            request.display_name,
            request.credential_name,
        )
        .await?;
    Ok(Json(RegisterOptions {
        ceremony: registration.ceremony,
        public_key: registration.options,
    }))
}

#[derive(Deserialize)]
pub struct RegisterFinish {
    ceremony: Uuid,
    credential: RegisterPublicKeyCredential,
}

pub async fn register_finish(
    State(app): State<App>,
    headers: HeaderMap,
    Json(request): Json<RegisterFinish>,
) -> Result<impl IntoResponse> {
    let registered = app
        .auth
        .finish_registration(&app.store, request.ceremony, request.credential)
        .await?;
    let user_id = registered.user.id;
    let cookies =
        SessionCookies::issue(&app.store, &app.config, user_id, user_agent(&headers)).await?;
    app.store
        .audit(Audit {
            user: Some(user_id),
            actor: "browser",
            kind: "user.bootstrap",
            target: &user_id.to_string(),
            result: "success",
        })
        .await?;
    Ok((cookies.headers, Json(registered)))
}

#[derive(Deserialize)]
pub struct LoginStart {
    username: String,
}

#[derive(Serialize)]
pub struct LoginOptions {
    ceremony: Uuid,
    public_key: RequestChallengeResponse,
}

pub async fn login_start(
    State(app): State<App>,
    Json(request): Json<LoginStart>,
) -> Result<Json<LoginOptions>> {
    let authentication = app
        .auth
        .begin_authentication(&app.store, &request.username)
        .await?;
    Ok(Json(LoginOptions {
        ceremony: authentication.ceremony,
        public_key: authentication.options,
    }))
}

#[derive(Deserialize)]
pub struct LoginFinish {
    ceremony: Uuid,
    credential: PublicKeyCredential,
}

#[derive(Serialize)]
pub struct Me {
    user: UserView,
}

pub async fn login_finish(
    State(app): State<App>,
    headers: HeaderMap,
    Json(request): Json<LoginFinish>,
) -> Result<impl IntoResponse> {
    let user = app
        .auth
        .finish_authentication(&app.store, request.ceremony, request.credential)
        .await?;
    let cookies =
        SessionCookies::issue(&app.store, &app.config, user.id, user_agent(&headers)).await?;
    app.store
        .audit(Audit {
            user: Some(user.id),
            actor: "browser",
            kind: "auth.login",
            target: &cookies.browser.to_string(),
            result: "success",
        })
        .await?;
    Ok((cookies.headers, Json(Me { user: user.into() })))
}

#[derive(Deserialize)]
pub struct Recover {
    username: String,
    code: String,
}

pub async fn recover(
    State(app): State<App>,
    headers: HeaderMap,
    Json(request): Json<Recover>,
) -> Result<impl IntoResponse> {
    let user = app.store.recover(&request.username, &request.code).await?;
    let cookies =
        SessionCookies::issue(&app.store, &app.config, user.id, user_agent(&headers)).await?;
    app.store
        .audit(Audit {
            user: Some(user.id),
            actor: "browser",
            kind: "auth.recovery",
            target: &cookies.browser.to_string(),
            result: "success",
        })
        .await?;
    Ok((cookies.headers, Json(Me { user: user.into() })))
}

pub async fn me(principal: Principal) -> Json<Me> {
    Json(Me {
        user: principal.user.into(),
    })
}

pub async fn logout(
    State(app): State<App>,
    principal: Principal,
    headers: HeaderMap,
) -> Result<impl IntoResponse> {
    principal.csrf(&headers)?;
    app.store
        .revoke_browser(principal.browser, principal.user.id)
        .await?;
    let cleared = SessionCookies::clear(&app.config)?;
    Ok((cleared, Json(serde_json::json!({ "ok": true }))))
}

pub async fn revoke(
    State(app): State<App>,
    principal: Principal,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    principal.csrf(&headers)?;
    app.store.revoke_browser(id, principal.user.id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn user_agent(headers: &HeaderMap) -> &str {
    headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
}
