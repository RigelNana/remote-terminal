use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::header::{AUTHORIZATION, COOKIE, SET_COOKIE},
    routing::{delete, get, patch, post},
};
use tower::ServiceBuilder;
use tower_http::{
    catch_panic::CatchPanicLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    sensitive_headers::{SetSensitiveRequestHeadersLayer, SetSensitiveResponseHeadersLayer},
    trace::TraceLayer,
};

use crate::{
    error::Result,
    routes::{audit, auth, device, pair, session, tunnel},
    state::App,
};

pub fn router(app: App) -> Router {
    let limit = app.config.body_limit;
    Router::new()
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/v1/auth/register/start", post(auth::register_start))
        .route("/v1/auth/register/finish", post(auth::register_finish))
        .route("/v1/auth/login/start", post(auth::login_start))
        .route("/v1/auth/login/finish", post(auth::login_finish))
        .route("/v1/auth/recover", post(auth::recover))
        .route("/v1/auth/me", get(auth::me))
        .route("/v1/auth/logout", post(auth::logout))
        .route("/v1/auth/sessions/{id}", delete(auth::revoke))
        .route("/v1/pair/device", post(pair::start))
        .route("/v1/pair/review", post(pair::review))
        .route("/v1/pair/authorize", post(pair::authorize))
        .route("/v1/pair/token", post(pair::token))
        .route("/v1/devices", get(device::list))
        .route(
            "/v1/devices/{id}",
            patch(device::rename).delete(device::revoke),
        )
        .route("/v1/sessions", get(session::list).post(session::create))
        .route("/v1/sessions/{id}", get(session::get))
        .route("/v1/sessions/{id}/stop", post(session::stop))
        .route(
            "/v1/sessions/{id}/attach",
            get(session::attach).post(session::grant),
        )
        .route("/v1/audit", get(audit::list))
        .route("/v1/agent/control", get(tunnel::control))
        .route("/v1/agent/sessions/{id}", get(tunnel::session))
        .layer(DefaultBodyLimit::max(limit))
        .layer(
            ServiceBuilder::new()
                .layer(SetSensitiveRequestHeadersLayer::new([
                    AUTHORIZATION,
                    COOKIE,
                ]))
                .layer(SetSensitiveResponseHeadersLayer::new([SET_COOKIE]))
                .layer(SetRequestIdLayer::new(
                    http::HeaderName::from_static("x-request-id"),
                    MakeRequestUuid,
                ))
                .layer(PropagateRequestIdLayer::new(http::HeaderName::from_static(
                    "x-request-id",
                )))
                .layer(TraceLayer::new_for_http())
                .layer(CatchPanicLayer::new()),
        )
        .with_state(app)
}

async fn live() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "live" }))
}

async fn ready(State(app): State<App>) -> Result<Json<serde_json::Value>> {
    app.store.ready().await?;
    Ok(Json(serde_json::json!({ "status": "ready" })))
}
