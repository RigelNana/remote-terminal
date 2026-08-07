use std::{str::FromStr, sync::Arc, time::Duration};

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use http::header::{AUTHORIZATION, SEC_WEBSOCKET_PROTOCOL};
use remote_proto::{
    id::SessionId,
    wire::{Envelope, Failure, Hello, Pong, envelope::Body},
};
use tokio::{sync::mpsc, time};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};
use tokio_util::sync::CancellationToken;

use crate::{
    config::Config,
    credential::Credential,
    error::{Error, Result},
    session::Sessions,
};

const PROTOCOL: &str = "remote-terminal.v1";

pub struct Link {
    config: Arc<Config>,
    credential: Arc<Credential>,
    sessions: Sessions,
    events: mpsc::Receiver<Envelope>,
}

impl Link {
    #[must_use]
    pub fn new(config: Config, credential: Credential) -> Self {
        let config = Arc::new(config);
        let credential = Arc::new(credential);
        let (sender, events) = mpsc::channel(256);
        let sessions = Sessions::new(config.clone(), credential.clone(), sender);
        Self {
            config,
            credential,
            sessions,
            events,
        }
    }

    pub async fn run(mut self, shutdown: CancellationToken) -> Result<()> {
        let mut delay = Duration::from_secs(1);
        loop {
            let result = self.connected(&shutdown).await;
            if shutdown.is_cancelled() {
                return Ok(());
            }
            match result {
                Ok(()) => delay = Duration::from_secs(1),
                Err(error) => tracing::warn!(%error, "relay control link disconnected"),
            }
            tokio::select! {
                () = shutdown.cancelled() => return Ok(()),
                () = time::sleep(delay) => {}
            }
            delay = (delay * 2).min(Duration::from_secs(30));
        }
    }

    async fn connected(&mut self, shutdown: &CancellationToken) -> Result<()> {
        let url = self.config.websocket("/v1/agent/control")?;
        let mut request = url.as_str().into_client_request()?;
        request.headers_mut().insert(
            AUTHORIZATION,
            format!("Device {}.{}", self.config.device, self.credential.expose())
                .parse()
                .map_err(|error| Error::Config(format!("invalid authorization header: {error}")))?,
        );
        request.headers_mut().insert(
            SEC_WEBSOCKET_PROTOCOL,
            PROTOCOL
                .parse()
                .map_err(|error| Error::Config(format!("invalid protocol header: {error}")))?,
        );
        let (socket, _) = connect_async(request).await?;
        tracing::info!(device = %self.config.device, "connected to relay");
        let (mut sink, mut stream) = socket.split();
        send(
            &mut sink,
            Envelope::frame(
                String::new(),
                Body::Hello(Hello {
                    device: self.config.device.to_string(),
                    agent: env!("CARGO_PKG_VERSION").into(),
                    platform: std::env::consts::OS.into(),
                    profiles: self.config.public_profiles(),
                }),
            ),
        )
        .await?;
        for frame in self.sessions.declarations() {
            send(&mut sink, frame).await?;
        }
        let mut heartbeat = time::interval(Duration::from_secs(20));
        heartbeat.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                () = shutdown.cancelled() => return Ok(()),
                event = self.events.recv() => {
                    let Some(event) = event else {
                        return Err(Error::Task("session event channel closed".into()));
                    };
                    send(&mut sink, event).await?;
                }
                message = stream.next() => {
                    let Some(message) = message else { return Ok(()) };
                    match message? {
                        Message::Binary(bytes) => {
                            let response = self.command(&bytes).await;
                            if let Some(frame) = response {
                                send(&mut sink, frame).await?;
                            }
                        }
                        Message::Ping(bytes) => sink.send(Message::Pong(bytes)).await?,
                        Message::Pong(_) => {}
                        Message::Close(_) => return Ok(()),
                        Message::Text(_) | Message::Frame(_) => {
                            return Err(Error::Pair("unexpected control websocket frame".into()));
                        }
                    }
                }
                _ = heartbeat.tick() => {
                    sink.send(Message::Ping(Bytes::from_static(b"rt"))).await?;
                }
            }
        }
    }

    async fn command(&self, bytes: &[u8]) -> Option<Envelope> {
        let frame = match Envelope::decode_frame(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                tracing::warn!(%error, "relay control frame rejected");
                return None;
            }
        };
        let session = SessionId::from_str(&frame.session).ok();
        match frame.body {
            Some(Body::Open(request)) => {
                let Some(id) = session else {
                    return Some(failure(None, "SESSION_MISSING", false));
                };
                match self.sessions.open(id, request).await {
                    Ok(ready) => Some(Envelope::frame(id.to_string(), Body::Ready(ready))),
                    Err(error) => {
                        tracing::warn!(session = %id, %error, "failed to open PTY session");
                        Some(failure(Some(id), "PROFILE_INVALID", false))
                    }
                }
            }
            Some(Body::Kill(request)) => {
                let Some(id) = session else {
                    return Some(failure(None, "SESSION_MISSING", false));
                };
                match self.sessions.stop(id, request.force).await {
                    Ok(()) => None,
                    Err(Error::NotFound) => Some(failure(Some(id), "SESSION_MISSING", false)),
                    Err(error) => {
                        tracing::warn!(session = %id, %error, "failed to stop PTY session");
                        Some(failure(Some(id), "PTY_STOP_FAILED", false))
                    }
                }
            }
            Some(Body::Ping(ping)) => Some(Envelope::frame(
                String::new(),
                Body::Pong(Pong { nonce: ping.nonce }),
            )),
            _ => Some(failure(session, "PROTOCOL_FRAME_INVALID", false)),
        }
    }
}

fn failure(session: Option<SessionId>, code: &str, retryable: bool) -> Envelope {
    Envelope::frame(
        session.map(|id| id.to_string()).unwrap_or_default(),
        Body::Failure(Failure {
            code: code.into(),
            retryable,
            detail: String::new(),
        }),
    )
}

async fn send<S>(sink: &mut S, frame: Envelope) -> Result<()>
where
    S: futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    sink.send(Message::Binary(frame.encode_frame()?)).await?;
    Ok(())
}
