use std::{str::FromStr, time::Duration};

use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::HeaderMap,
    response::Response,
};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use remote_proto::{
    MAX_FRAME,
    id::SessionId,
    wire::{Envelope, envelope::Body},
};
use tokio::{sync::mpsc, time};

use crate::{
    error::{Error, Result},
    model::{Audit, SessionState},
    state::App,
    ticket::Kind,
};

use super::device::Agent;

const PROTOCOL: &str = "remote-terminal.v1";

pub async fn control(
    State(app): State<App>,
    agent: Agent,
    ws: WebSocketUpgrade,
) -> Result<Response> {
    Ok(ws
        .max_message_size(MAX_FRAME)
        .max_frame_size(MAX_FRAME)
        .protocols([PROTOCOL])
        .on_upgrade(move |socket| control_socket(app, agent, socket)))
}

async fn control_socket(app: App, agent: Agent, socket: WebSocket) {
    let (generation, mut outbound, cancel) = app.hub.online(agent.device);
    let (mut sink, mut stream) = socket.split();
    let mut heartbeat = time::interval(Duration::from_secs(20));
    heartbeat.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    let mut hello = false;
    loop {
        tokio::select! {
            biased;
            () = cancel.cancelled() => break,
            frame = outbound.recv() => {
                let Some(frame) = frame else { break };
                let Ok(message) = frame
                    .encode_frame()
                    .map(Message::Binary)
                    .map_err(Error::from)
                else {
                    break;
                };
                if sink.send(message).await.is_err() {
                    break;
                }
            }
            message = stream.next() => {
                let Some(Ok(message)) = message else { break };
                match control_message(&app, agent, message, &mut hello).await {
                    Ok(()) => {}
                    Err(error) => {
                        tracing::warn!(device = %agent.device, %error, "agent control frame rejected");
                        break;
                    }
                }
            }
            _ = heartbeat.tick() => {
                if sink.send(Message::Ping(Bytes::from_static(b"rt"))).await.is_err() {
                    break;
                }
            }
        }
    }
    if app.hub.offline(agent.device, generation) {
        if let Err(error) = app.store.offline_device(agent.device).await {
            tracing::error!(device = %agent.device, %error, "failed to mark device offline");
        }
        let _ = app
            .store
            .audit(Audit {
                user: Some(agent.user),
                actor: "agent",
                kind: "device.disconnect",
                target: &agent.device.to_string(),
                result: "success",
            })
            .await;
    }
}

async fn control_message(
    app: &App,
    agent: Agent,
    message: Message,
    hello_seen: &mut bool,
) -> Result<()> {
    match message {
        Message::Binary(bytes) => {
            let frame = Envelope::decode_frame(&bytes)?;
            match frame.body.as_ref() {
                Some(Body::Hello(hello)) => {
                    if *hello_seen || hello.device != agent.device.to_string() {
                        return Err(Error::Forbidden);
                    }
                    app.store
                        .online_device(agent.device, &hello.agent, &hello.profiles)
                        .await?;
                    *hello_seen = true;
                    app.store
                        .audit(Audit {
                            user: Some(agent.user),
                            actor: "agent",
                            kind: "device.connect",
                            target: &agent.device.to_string(),
                            result: "success",
                        })
                        .await?;
                }
                Some(Body::Ready(ready)) if *hello_seen => {
                    let session = parse_session(&frame)?;
                    app.store.session_device(session, agent.device).await?;
                    app.store.running_session(session, ready.pid).await?;
                    app.hub
                        .create_session(session, agent.user, agent.device)
                        .publish(bytes);
                }
                Some(Body::Exit(exit)) if *hello_seen => {
                    let session = parse_session(&frame)?;
                    app.store.session_device(session, agent.device).await?;
                    app.store
                        .exit_session(session, Some(exit.code), &exit.reason)
                        .await?;
                    if let Ok(link) = app.hub.session(session) {
                        link.publish(bytes);
                    }
                }
                Some(Body::Failure(failure)) if *hello_seen => {
                    let session = parse_session(&frame)?;
                    app.store.session_device(session, agent.device).await?;
                    app.store.exit_session(session, None, &failure.code).await?;
                    if let Ok(link) = app.hub.session(session) {
                        link.publish(bytes);
                    }
                }
                Some(Body::Pong(_)) if *hello_seen => {
                    app.store.seen_device(agent.device).await?;
                }
                _ => return Err(Error::Invalid("unexpected agent control frame".into())),
            }
            Ok(())
        }
        Message::Pong(_) => {
            if *hello_seen {
                app.store.seen_device(agent.device).await?;
            }
            Ok(())
        }
        Message::Close(_) => Err(Error::Offline),
        Message::Ping(_) => Ok(()),
        Message::Text(_) => Err(Error::Invalid("control frames must be binary".into())),
    }
}

pub async fn session(
    State(app): State<App>,
    agent: Agent,
    Path(id): Path<SessionId>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response> {
    let stored = app.store.session_device(id, agent.device).await?;
    if let Some(ticket) = headers
        .get("x-session-ticket")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
    {
        let claim = app.tickets.consume(ticket, Kind::Agent)?;
        if claim.device != agent.device || claim.session != id || claim.user != agent.user {
            return Err(Error::Forbidden);
        }
    } else if !matches!(
        stored.state,
        SessionState::Starting | SessionState::Running | SessionState::Lost
    ) {
        return Err(Error::Conflict);
    }
    let link = app.hub.create_session(id, agent.user, agent.device);
    Ok(ws
        .max_message_size(MAX_FRAME)
        .max_frame_size(MAX_FRAME)
        .protocols([PROTOCOL])
        .on_upgrade(move |socket| session_socket(app, link, socket)))
}

async fn session_socket(
    app: App,
    link: std::sync::Arc<crate::hub::SessionLink>,
    socket: WebSocket,
) {
    let (mut sink, mut stream) = socket.split();
    let (sender, mut outbound) = mpsc::channel(app.config.queue);
    let generation = link.bind_agent(sender).await;
    let mut heartbeat = time::interval(Duration::from_secs(20));
    heartbeat.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            frame = outbound.recv() => {
                let Some(frame) = frame else { break };
                if sink.send(Message::Binary(frame)).await.is_err() {
                    break;
                }
            }
            message = stream.next() => {
                let Some(Ok(message)) = message else { break };
                match message {
                    Message::Binary(bytes) => {
                        if !link.agent_current(generation).await {
                            break;
                        }
                        match validate_data(&bytes, link.id) {
                            Ok(frame) => {
                                if let Some(Body::Exit(exit)) = frame.body.as_ref() {
                                    let _ = app.store.exit_session(link.id, Some(exit.code), &exit.reason).await;
                                }
                                link.publish(bytes);
                            }
                            Err(error) => {
                                tracing::warn!(session = %link.id, %error, "agent data frame rejected");
                                break;
                            }
                        }
                    }
                    Message::Ping(bytes) => {
                        if sink.send(Message::Pong(bytes)).await.is_err() { break; }
                    }
                    Message::Pong(_) => {}
                    Message::Close(_) | Message::Text(_) => break,
                }
            }
            _ = heartbeat.tick() => {
                if sink.send(Message::Ping(Bytes::from_static(b"rt"))).await.is_err() {
                    break;
                }
            }
        }
    }
    link.unbind_agent(generation).await;
}

fn validate_data(bytes: &[u8], session: SessionId) -> Result<Envelope> {
    let frame = Envelope::decode_frame(bytes)?;
    if parse_session(&frame)? != session {
        return Err(Error::Forbidden);
    }
    match frame.body {
        Some(
            Body::Output(_)
            | Body::Snapshot(_)
            | Body::Gap(_)
            | Body::Exit(_)
            | Body::Failure(_)
            | Body::Ready(_)
            | Body::Pong(_),
        ) => Ok(frame),
        _ => Err(Error::Invalid("unexpected agent data frame".into())),
    }
}

fn parse_session(frame: &Envelope) -> Result<SessionId> {
    SessionId::from_str(&frame.session).map_err(|_| Error::Invalid("invalid session ID".into()))
}
