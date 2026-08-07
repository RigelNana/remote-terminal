use std::{str::FromStr, sync::Arc, time::Duration};

use axum::{
    Json,
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, header},
    response::Response,
};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use remote_proto::{
    MAX_FRAME,
    id::{AttachId, DeviceId, SessionId},
    wire::{
        Ack, Attach, Detach, Envelope, Failure, Input, Kill, Open, Resize, Role, Size,
        envelope::Body,
    },
};
use serde::{Deserialize, Serialize};
use tokio::{sync::broadcast, time};
use url::Url;

use crate::{
    browser::Principal,
    error::{Error, Result},
    hub::SessionLink,
    model::{Audit, DeviceState, Session, SessionState},
    state::App,
    ticket::{Claim, Kind},
};

const PROTOCOL: &str = "remote-terminal.v1";

#[derive(Deserialize)]
pub struct Create {
    device: DeviceId,
    profile: String,
    #[serde(default)]
    cwd: String,
    size: Option<Size>,
}

pub async fn create(
    State(app): State<App>,
    principal: Principal,
    headers: HeaderMap,
    Json(request): Json<Create>,
) -> Result<Json<Session>> {
    principal.csrf(&headers)?;
    validate_size(request.size.as_ref())?;
    let idempotency = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| (8..=128).contains(&value.len()))
        .ok_or_else(|| Error::Invalid("a valid Idempotency-Key header is required".into()))?;
    let device = app.store.device(principal.user.id, request.device).await?;
    if device.state != DeviceState::Online || !app.hub.online_now(device.id) {
        return Err(Error::Offline);
    }
    if !device
        .profiles
        .iter()
        .any(|profile| profile.id == request.profile)
    {
        return Err(Error::Invalid(
            "profile is not available on this device".into(),
        ));
    }
    let (session, created) = app
        .store
        .create_session(
            principal.user.id,
            request.device,
            &request.profile,
            &request.cwd,
            idempotency,
        )
        .await?;
    if !created {
        return Ok(Json(session));
    }
    app.hub
        .create_session(session.id, principal.user.id, request.device);
    let ticket = app.tickets.issue(
        Claim {
            kind: Kind::Agent,
            user: principal.user.id,
            device: request.device,
            session: session.id,
            attach: None,
            from: 0,
            expires_at: 0,
        },
        app.config.ticket_seconds,
    );
    let frame = Envelope::frame(
        session.id.to_string(),
        Body::Open(Open {
            profile: request.profile,
            cwd: request.cwd,
            size: request.size,
            ticket,
        }),
    );
    if let Err(error) = app.hub.send(request.device, frame).await {
        app.store
            .exit_session(session.id, None, "dispatch_failed")
            .await?;
        return Err(error);
    }
    app.store
        .audit(Audit {
            user: Some(principal.user.id),
            actor: "browser",
            kind: "session.create",
            target: &session.id.to_string(),
            result: "success",
        })
        .await?;
    Ok(Json(session))
}

pub async fn list(State(app): State<App>, principal: Principal) -> Result<Json<Vec<Session>>> {
    Ok(Json(app.store.sessions(principal.user.id).await?))
}

pub async fn get(
    State(app): State<App>,
    principal: Principal,
    Path(id): Path<SessionId>,
) -> Result<Json<Session>> {
    Ok(Json(app.store.session(principal.user.id, id).await?))
}

#[derive(Deserialize)]
pub struct AttachRequest {
    #[serde(default)]
    from: u64,
}

#[derive(Serialize)]
pub struct AttachGrant {
    attach: AttachId,
    ticket: String,
    url: String,
}

pub async fn grant(
    State(app): State<App>,
    principal: Principal,
    headers: HeaderMap,
    Path(id): Path<SessionId>,
    Json(request): Json<AttachRequest>,
) -> Result<Json<AttachGrant>> {
    principal.csrf(&headers)?;
    let session = app.store.session(principal.user.id, id).await?;
    if session.state != SessionState::Running {
        return Err(Error::Conflict);
    }
    let attach = AttachId::new();
    let ticket = app.tickets.issue(
        Claim {
            kind: Kind::Browser,
            user: principal.user.id,
            device: session.device,
            session: id,
            attach: Some(attach),
            from: request.from,
            expires_at: 0,
        },
        app.config.ticket_seconds,
    );
    let url = app
        .config
        .websocket_url(&format!("/v1/sessions/{id}/attach"))
        .to_string();
    Ok(Json(AttachGrant {
        attach,
        ticket,
        url,
    }))
}

#[derive(Deserialize)]
pub struct TicketQuery {
    ticket: String,
}

pub async fn attach(
    State(app): State<App>,
    principal: Principal,
    headers: HeaderMap,
    Path(id): Path<SessionId>,
    Query(query): Query<TicketQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response> {
    check_origin(&app, &headers)?;
    let claim = app.tickets.consume(&query.ticket, Kind::Browser)?;
    let attach = claim.attach.ok_or(Error::Forbidden)?;
    if claim.user != principal.user.id || claim.session != id {
        return Err(Error::Forbidden);
    }
    let session = app.store.session(principal.user.id, id).await?;
    if session.device != claim.device || session.state != SessionState::Running {
        return Err(Error::Conflict);
    }
    let link = app.hub.session(id)?;
    Ok(ws
        .max_message_size(MAX_FRAME)
        .max_frame_size(MAX_FRAME)
        .protocols([PROTOCOL])
        .on_upgrade(move |socket| browser_socket(link, attach, claim.from, socket)))
}

#[derive(Deserialize)]
pub struct Stop {
    #[serde(default)]
    force: bool,
}

pub async fn stop(
    State(app): State<App>,
    principal: Principal,
    headers: HeaderMap,
    Path(id): Path<SessionId>,
    Json(request): Json<Stop>,
) -> Result<Json<serde_json::Value>> {
    principal.csrf(&headers)?;
    let session = app.store.session(principal.user.id, id).await?;
    if !matches!(
        session.state,
        SessionState::Starting | SessionState::Running | SessionState::Lost
    ) {
        return Err(Error::Conflict);
    }
    app.hub
        .send(
            session.device,
            Envelope::frame(
                id.to_string(),
                Body::Kill(Kill {
                    force: request.force,
                }),
            ),
        )
        .await?;
    app.store
        .audit(Audit {
            user: Some(principal.user.id),
            actor: "browser",
            kind: if request.force {
                "session.force"
            } else {
                "session.stop"
            },
            target: &id.to_string(),
            result: "requested",
        })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn browser_socket(link: Arc<SessionLink>, attach: AttachId, from: u64, socket: WebSocket) {
    let control = link.acquire(attach);
    let (mut sink, mut stream) = socket.split();
    let mut output = link.subscribe();
    let role = Envelope::frame(
        link.id.to_string(),
        Body::Role(Role {
            attach: attach.to_string(),
            control,
            lease_expires: 0,
        }),
    );
    if send_frame(&mut sink, role).await.is_err() {
        link.release(attach);
        return;
    }
    let attached = Envelope::frame(
        link.id.to_string(),
        Body::Attach(Attach {
            attach: attach.to_string(),
            from,
            control,
        }),
    );
    if send_agent(&link, attached).await.is_err() {
        link.release(attach);
        return;
    }
    let mut heartbeat = time::interval(Duration::from_secs(20));
    heartbeat.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            message = stream.next() => {
                let Some(Ok(message)) = message else { break };
                match message {
                    Message::Binary(bytes) => {
                        match browser_frame(&bytes, link.id, attach, link.controls(attach)) {
                            Ok(frame) => {
                                if send_agent(&link, frame).await.is_err() { break; }
                            }
                            Err(Error::Forbidden) => {
                                let failure = Envelope::frame(link.id.to_string(), Body::Failure(Failure {
                                    code: "CONTROL_DENIED".into(),
                                    retryable: false,
                                    detail: String::new(),
                                }));
                                if send_frame(&mut sink, failure).await.is_err() { break; }
                            }
                            Err(_) => break,
                        }
                    }
                    Message::Ping(bytes) => {
                        if sink.send(Message::Pong(bytes)).await.is_err() { break; }
                    }
                    Message::Pong(_) => {}
                    Message::Close(_) | Message::Text(_) => break,
                }
            }
            received = output.recv() => {
                match received {
                    Ok(bytes) => {
                        if visible(&bytes, attach)
                            && sink.send(Message::Binary(bytes)).await.is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) | Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = heartbeat.tick() => {
                if sink.send(Message::Ping(Bytes::from_static(b"rt"))).await.is_err() {
                    break;
                }
            }
        }
    }
    let _ = send_agent(
        &link,
        Envelope::frame(
            link.id.to_string(),
            Body::Detach(Detach {
                attach: attach.to_string(),
            }),
        ),
    )
    .await;
    link.release(attach);
}

fn browser_frame(
    bytes: &[u8],
    session: SessionId,
    attach: AttachId,
    control: bool,
) -> Result<Envelope> {
    let frame = Envelope::decode_frame(bytes)?;
    if SessionId::from_str(&frame.session).ok() != Some(session) {
        return Err(Error::Forbidden);
    }
    let body = match frame.body {
        Some(Body::Input(input)) if control => Body::Input(Input {
            attach: attach.to_string(),
            sequence: input.sequence,
            data: input.data,
        }),
        Some(Body::Resize(resize)) if control => Body::Resize(Resize {
            attach: attach.to_string(),
            size: resize.size,
        }),
        Some(Body::Ack(ack)) => Body::Ack(Ack {
            attach: attach.to_string(),
            end: ack.end,
        }),
        Some(Body::Ping(ping)) => Body::Ping(ping),
        Some(Body::Input(_) | Body::Resize(_)) => return Err(Error::Forbidden),
        _ => return Err(Error::Invalid("unexpected browser data frame".into())),
    };
    Ok(Envelope::frame(session.to_string(), body))
}

fn visible(bytes: &[u8], attach: AttachId) -> bool {
    let Ok(frame) = Envelope::decode_frame(bytes) else {
        return false;
    };
    let target = match frame.body {
        Some(Body::Output(output)) => output.target,
        Some(Body::Gap(gap)) => gap.target,
        Some(Body::Role(role)) => role.attach,
        _ => String::new(),
    };
    target.is_empty() || target == attach.to_string()
}

async fn send_agent(link: &SessionLink, frame: Envelope) -> Result<()> {
    link.send_agent(frame.encode_frame()?).await
}

async fn send_frame(
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    frame: Envelope,
) -> Result<()> {
    sink.send(Message::Binary(frame.encode_frame()?))
        .await
        .map_err(|error| Error::Internal(error.to_string()))
}

fn validate_size(size: Option<&Size>) -> Result<()> {
    let size = size.ok_or_else(|| Error::Invalid("terminal size is required".into()))?;
    if !(2..=1000).contains(&size.cols) || !(1..=1000).contains(&size.rows) {
        return Err(Error::Invalid(
            "terminal size is outside supported bounds".into(),
        ));
    }
    Ok(())
}

fn check_origin(app: &App, headers: &HeaderMap) -> Result<()> {
    let actual = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| Url::parse(value).ok())
        .ok_or(Error::Forbidden)?;
    if actual.origin() != app.config.origin.origin() {
        return Err(Error::Forbidden);
    }
    Ok(())
}
