use std::{
    io::{Read, Write},
    path::PathBuf,
    str::FromStr,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use bytes::Bytes;
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use http::header::{AUTHORIZATION, SEC_WEBSOCKET_PROTOCOL};
use parking_lot::Mutex;
use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use remote_proto::{
    id::{AttachId, SessionId},
    wire::{
        Ack, Envelope, Exit, Failure, Open, Output, Pong, Ready, Size, Snapshot, envelope::Body,
    },
};
use tokio::{
    sync::{Notify, broadcast, mpsc, oneshot},
    task, time,
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};
use tokio_util::sync::CancellationToken;

use crate::{
    config::{Config, Profile},
    credential::Credential,
    error::{Error, Result},
    journal::{Chunk, Journal},
};

const READ_CHUNK: usize = 16 * 1024;
const ACK_WINDOW: u64 = 1024 * 1024;
const RETAIN_AFTER_EXIT: Duration = Duration::from_secs(300);
const PROTOCOL: &str = "remote-terminal.v1";

#[derive(Clone)]
pub struct Sessions {
    config: Arc<Config>,
    credential: Arc<Credential>,
    sessions: Arc<DashMap<SessionId, Arc<Session>>>,
    events: mpsc::Sender<Envelope>,
}

struct Spawned {
    master: Box<dyn MasterPty + Send>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: u32,
}

pub struct Session {
    id: SessionId,
    profile: String,
    pid: u32,
    config: Arc<Config>,
    credential: Arc<Credential>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    size: Mutex<Size>,
    input: mpsc::Sender<Bytes>,
    terminal: Mutex<TerminalState>,
    live: broadcast::Sender<Chunk>,
    attachments: DashMap<AttachId, u64>,
    ack: Notify,
    online: AtomicBool,
    connected: Notify,
    cancel: CancellationToken,
    ticket: Mutex<Option<String>>,
}

struct TerminalState {
    journal: Journal,
    parser: vt100::Parser,
}

impl TerminalState {
    fn new(journal_bytes: usize, size: &Size) -> Result<Self> {
        let size = pty_size(size)?;
        Ok(Self {
            journal: Journal::new(journal_bytes),
            parser: vt100::Parser::new(size.rows, size.cols, 0),
        })
    }

    fn push(&mut self, bytes: Bytes) -> Chunk {
        self.parser.process(&bytes);
        self.journal.push(bytes)
    }

    fn snapshot(&self, target: String) -> Snapshot {
        Snapshot {
            target,
            end: self.journal.end(),
            data: Bytes::from(self.parser.screen().state_formatted()),
        }
    }

    fn resize(&mut self, size: &Size) -> Result<()> {
        let size = pty_size(size)?;
        self.parser.screen_mut().set_size(size.rows, size.cols);
        Ok(())
    }
}

impl Sessions {
    #[must_use]
    pub fn new(
        config: Arc<Config>,
        credential: Arc<Credential>,
        events: mpsc::Sender<Envelope>,
    ) -> Self {
        Self {
            config,
            credential,
            sessions: Arc::new(DashMap::new()),
            events,
        }
    }

    pub async fn open(&self, id: SessionId, request: Open) -> Result<Ready> {
        if let Some(session) = self.sessions.get(&id) {
            return Ok(session.ready());
        }
        let profile = self.config.profile(&request.profile)?.clone();
        let profile_id = request.profile.clone();
        let size = validated_size(request.size)?;
        let cwd = if request.cwd.is_empty() {
            profile.cwd.clone()
        } else {
            PathBuf::from(&request.cwd)
        };
        if !cwd.is_dir() {
            return Err(Error::Config(
                "requested working directory does not exist".into(),
            ));
        }
        let spawn_size = size;
        let spawned = task::spawn_blocking(move || spawn(profile, cwd, &spawn_size))
            .await
            .map_err(|error| Error::Task(error.to_string()))??;
        let ready_size = size;
        let (output_tx, output_rx) = mpsc::channel(32);
        let (input_tx, input_rx) = mpsc::channel(32);
        let (exit_tx, exit_rx) = oneshot::channel();
        spawn_reader(spawned.reader, output_tx);
        spawn_writer(spawned.writer, input_rx);
        spawn_waiter(spawned.child, exit_tx);
        let (live, _) = broadcast::channel(256);
        let session = Arc::new(Session {
            id,
            profile: profile_id.clone(),
            pid: spawned.pid,
            config: self.config.clone(),
            credential: self.credential.clone(),
            master: Arc::new(Mutex::new(spawned.master)),
            killer: Arc::new(Mutex::new(spawned.killer)),
            size: Mutex::new(ready_size),
            input: input_tx,
            terminal: Mutex::new(TerminalState::new(self.config.journal_bytes, &size)?),
            live,
            attachments: DashMap::new(),
            ack: Notify::new(),
            online: AtomicBool::new(false),
            connected: Notify::new(),
            cancel: CancellationToken::new(),
            ticket: Mutex::new(Some(request.ticket)),
        });
        self.sessions.insert(id, session.clone());
        let events = self.events.clone();
        let sessions = self.sessions.clone();
        let running = session.clone();
        tokio::spawn(async move {
            running.run(output_rx, exit_rx, events).await;
            sessions.remove(&id);
        });
        if time::timeout(Duration::from_secs(10), session.wait_online())
            .await
            .is_err()
        {
            session.cancel.cancel();
            let _ = session.stop(true).await;
            return Err(Error::Pair("session data link did not connect".into()));
        }
        Ok(Ready {
            profile: profile_id,
            size: Some(size),
            start: 0,
            pid: spawned.pid,
        })
    }

    pub async fn stop(&self, id: SessionId, force: bool) -> Result<()> {
        let session = self
            .sessions
            .get(&id)
            .map(|entry| entry.clone())
            .ok_or(Error::NotFound)?;
        session.stop(force).await
    }

    #[must_use]
    pub fn declarations(&self) -> Vec<Envelope> {
        self.sessions
            .iter()
            .map(|entry| Envelope::frame(entry.id.to_string(), Body::Ready(entry.ready())))
            .collect()
    }
}

impl Session {
    fn ready(&self) -> Ready {
        Ready {
            profile: self.profile.clone(),
            size: Some(*self.size.lock()),
            start: self.terminal.lock().journal.end(),
            pid: self.pid,
        }
    }

    async fn run(
        self: Arc<Self>,
        output: mpsc::Receiver<Bytes>,
        exit: oneshot::Receiver<std::io::Result<portable_pty::ExitStatus>>,
        events: mpsc::Sender<Envelope>,
    ) {
        let collect = tokio::spawn(self.clone().collect(output));
        let data = tokio::spawn(self.clone().connect());
        let status = match exit.await {
            Ok(Ok(status)) => status,
            Ok(Err(error)) => {
                let frame = Envelope::frame(
                    self.id.to_string(),
                    Body::Failure(Failure {
                        code: "PTY_WAIT_FAILED".into(),
                        retryable: false,
                        detail: error.kind().to_string(),
                    }),
                );
                let _ = events.send(frame).await;
                self.cancel.cancel();
                let _ = collect.await;
                let _ = data.await;
                return;
            }
            Err(_) => {
                self.cancel.cancel();
                let _ = collect.await;
                let _ = data.await;
                return;
            }
        };
        let frame = Envelope::frame(
            self.id.to_string(),
            Body::Exit(Exit {
                code: i32::try_from(status.exit_code()).unwrap_or(i32::MAX),
                signal: status.signal().unwrap_or_default().into(),
                reason: if status.success() {
                    "exited".into()
                } else {
                    "process_failed".into()
                },
                end: self.terminal.lock().journal.end(),
            }),
        );
        let _ = events.send(frame).await;
        time::sleep(RETAIN_AFTER_EXIT).await;
        self.cancel.cancel();
        let _ = collect.await;
        let _ = data.await;
    }

    async fn collect(self: Arc<Self>, mut output: mpsc::Receiver<Bytes>) {
        loop {
            while self.over_window() {
                tokio::select! {
                    () = self.cancel.cancelled() => return,
                    () = self.ack.notified() => {}
                }
            }
            let bytes = tokio::select! {
                () = self.cancel.cancelled() => return,
                value = output.recv() => value,
            };
            let Some(bytes) = bytes else {
                return;
            };
            let chunk = self.terminal.lock().push(bytes);
            let _ = self.live.send(chunk);
        }
    }

    fn over_window(&self) -> bool {
        if self.attachments.is_empty() {
            return false;
        }
        let end = self.terminal.lock().journal.end();
        self.attachments
            .iter()
            .any(|entry| end.saturating_sub(*entry.value()) > ACK_WINDOW)
    }

    async fn wait_online(&self) {
        loop {
            let notified = self.connected.notified();
            if self.online.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }
    async fn connect(self: Arc<Self>) {
        let mut delay = Duration::from_secs(1);

        while !self.cancel.is_cancelled() {
            match self.connect_once().await {
                Ok(()) => delay = Duration::from_secs(1),
                Err(error) => {
                    tracing::warn!(session = %self.id, %error, "session data link disconnected");
                }
            }
            tokio::select! {
                () = self.cancel.cancelled() => break,
                () = time::sleep(delay) => {}
            }
            delay = (delay * 2).min(Duration::from_secs(30));
        }
    }

    async fn connect_once(&self) -> Result<()> {
        let url = self
            .config
            .websocket(&format!("/v1/agent/sessions/{}", self.id))?;
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
        let initial_ticket = self.ticket.lock().clone();
        if let Some(ticket) = initial_ticket.as_ref() {
            request.headers_mut().insert(
                "x-session-ticket",
                ticket
                    .parse()
                    .map_err(|error| Error::Config(format!("invalid ticket header: {error}")))?,
            );
        }
        let (socket, _) = connect_async(request).await?;
        if initial_ticket.is_some() {
            *self.ticket.lock() = None;
        }
        let result = self.data(socket).await;
        self.online.store(false, Ordering::Release);
        self.attachments.clear();
        self.ack.notify_waiters();
        result
    }

    async fn data(
        &self,
        socket: tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    ) -> Result<()> {
        self.online.store(true, Ordering::Release);
        self.connected.notify_waiters();
        let (mut sink, mut stream) = socket.split();
        let mut live = self.live.subscribe();
        let mut heartbeat = time::interval(Duration::from_secs(20));
        heartbeat.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                () = self.cancel.cancelled() => return Ok(()),
                received = live.recv() => {
                    match received {
                        Ok(chunk) => send(&mut sink, output(self.id, String::new(), chunk)).await?,
                        Err(broadcast::error::RecvError::Lagged(_)) => return Err(Error::Pair("session output link lagged".into())),
                        Err(broadcast::error::RecvError::Closed) => return Ok(()),
                    }
                }
                message = stream.next() => {
                    let Some(message) = message else { return Ok(()) };
                    match message? {
                        Message::Binary(bytes) => self.command(&mut sink, &bytes).await?,
                        Message::Ping(bytes) => sink.send(Message::Pong(bytes)).await?,
                        Message::Pong(_) => {}
                        Message::Close(_) => return Ok(()),
                        Message::Text(_) | Message::Frame(_) => return Err(Error::Pair("unexpected session websocket frame".into())),
                    }
                }
                _ = heartbeat.tick() => {
                    sink.send(Message::Ping(Bytes::from_static(b"rt"))).await?;
                }
            }
        }
    }

    async fn command<S>(&self, sink: &mut S, bytes: &[u8]) -> Result<()>
    where
        S: futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
    {
        let frame = Envelope::decode_frame(bytes)?;
        if SessionId::from_str(&frame.session).ok() != Some(self.id) {
            return Err(Error::Authentication);
        }
        match frame.body {
            Some(Body::Attach(attach)) => {
                let id = AttachId::from_str(&attach.attach).map_err(|_| Error::Authentication)?;
                let snapshot = self.terminal.lock().snapshot(id.to_string());
                self.attachments.insert(id, snapshot.end);
                send(
                    sink,
                    Envelope::frame(self.id.to_string(), Body::Snapshot(snapshot)),
                )
                .await?;
            }
            Some(Body::Detach(detach)) => {
                let id = AttachId::from_str(&detach.attach).map_err(|_| Error::Authentication)?;
                self.attachments.remove(&id);
                self.ack.notify_waiters();
            }
            Some(Body::Input(input)) => {
                let id = AttachId::from_str(&input.attach).map_err(|_| Error::Authentication)?;
                if !self.attachments.contains_key(&id) {
                    return Err(Error::Authentication);
                }
                self.input
                    .send(input.data)
                    .await
                    .map_err(|_| Error::Pty("PTY input closed".into()))?;
            }
            Some(Body::Resize(resize)) => {
                let id = AttachId::from_str(&resize.attach).map_err(|_| Error::Authentication)?;
                if !self.attachments.contains_key(&id) {
                    return Err(Error::Authentication);
                }
                self.resize(validated_size(resize.size)?).await?;
            }
            Some(Body::Ack(Ack { attach, end })) => {
                let id = AttachId::from_str(&attach).map_err(|_| Error::Authentication)?;
                if let Some(mut offset) = self.attachments.get_mut(&id) {
                    *offset = (*offset).max(end);
                    self.ack.notify_waiters();
                }
            }
            Some(Body::Ping(ping)) => {
                send(
                    sink,
                    Envelope::frame(self.id.to_string(), Body::Pong(Pong { nonce: ping.nonce })),
                )
                .await?;
            }
            _ => return Err(Error::Pair("unexpected relay session frame".into())),
        }
        Ok(())
    }

    async fn resize(&self, size: Size) -> Result<()> {
        let master = self.master.clone();
        let pty = pty_size(&size)?;
        task::spawn_blocking(move || master.lock().resize(pty))
            .await
            .map_err(|error| Error::Task(error.to_string()))?
            .map_err(|error| Error::Pty(error.to_string()))?;
        *self.size.lock() = size;
        self.terminal.lock().resize(&size)?;
        Ok(())
    }

    async fn stop(&self, force: bool) -> Result<()> {
        if !force {
            self.input
                .send(Bytes::from_static(b"\x04"))
                .await
                .map_err(|_| Error::Pty("PTY input closed".into()))?;
            return Ok(());
        }
        let killer = self.killer.clone();
        task::spawn_blocking(move || killer.lock().kill())
            .await
            .map_err(|error| Error::Task(error.to_string()))?
            .map_err(|error| Error::Pty(error.to_string()))
    }
}

fn spawn(profile: Profile, cwd: PathBuf, size: &Size) -> Result<Spawned> {
    let system = native_pty_system();
    let pair = system
        .openpty(pty_size(size)?)
        .map_err(|error| Error::Pty(error.to_string()))?;
    let mut command = CommandBuilder::new(&profile.shell);
    command.args(&profile.args);
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    for (key, value) in profile.env {
        command.env(key, value);
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| Error::Pty(error.to_string()))?;
    let pid = child.process_id().unwrap_or(0);
    let killer = child.clone_killer();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| Error::Pty(error.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| Error::Pty(error.to_string()))?;
    drop(pair.slave);
    Ok(Spawned {
        master: pair.master,
        reader,
        writer,
        child,
        killer,
        pid,
    })
}

fn spawn_reader(mut reader: Box<dyn Read + Send>, sender: mpsc::Sender<Bytes>) {
    task::spawn_blocking(move || {
        let mut buffer = vec![0; READ_CHUNK];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => return,
                Ok(count) => {
                    if sender
                        .blocking_send(Bytes::copy_from_slice(&buffer[..count]))
                        .is_err()
                    {
                        return;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => return,
            }
        }
    });
}

fn spawn_writer(mut writer: Box<dyn Write + Send>, mut input: mpsc::Receiver<Bytes>) {
    task::spawn_blocking(move || {
        while let Some(bytes) = input.blocking_recv() {
            if writer
                .write_all(&bytes)
                .and_then(|()| writer.flush())
                .is_err()
            {
                return;
            }
        }
    });
}

fn spawn_waiter(
    mut child: Box<dyn Child + Send + Sync>,
    sender: oneshot::Sender<std::io::Result<portable_pty::ExitStatus>>,
) {
    task::spawn_blocking(move || {
        let _ = sender.send(child.wait());
    });
}

fn validated_size(size: Option<Size>) -> Result<Size> {
    let size = size.ok_or_else(|| Error::Config("terminal size is required".into()))?;
    pty_size(&size)?;
    Ok(size)
}

fn pty_size(size: &Size) -> Result<PtySize> {
    Ok(PtySize {
        rows: u16::try_from(size.rows)
            .map_err(|_| Error::Config("rows exceed PTY bounds".into()))?,
        cols: u16::try_from(size.cols)
            .map_err(|_| Error::Config("columns exceed PTY bounds".into()))?,
        pixel_width: u16::try_from(size.pixel_width)
            .map_err(|_| Error::Config("pixel width exceeds PTY bounds".into()))?,
        pixel_height: u16::try_from(size.pixel_height)
            .map_err(|_| Error::Config("pixel height exceeds PTY bounds".into()))?,
    })
}

fn output(id: SessionId, target: String, chunk: Chunk) -> Envelope {
    Envelope::frame(
        id.to_string(),
        Body::Output(Output {
            target,
            start: chunk.start,
            end: chunk.end,
            data: chunk.data,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_contains_only_the_visible_screen_at_the_current_offset() {
        let size = Size {
            cols: 20,
            rows: 4,
            pixel_width: 0,
            pixel_height: 0,
        };
        let mut terminal = TerminalState::new(1024 * 1024, &size).unwrap();
        let journal = (1..=80)
            .map(|line| format!("line {line:03}\r\n"))
            .collect::<String>();
        terminal.push(Bytes::from(journal.clone()));

        let snapshot = terminal.snapshot("attachment".into());

        assert_eq!(snapshot.end, journal.len() as u64);
        assert!(snapshot.data.len() < journal.len());
        assert!(!snapshot.data.windows(8).any(|bytes| bytes == b"line 001"));

        let mut restored = vt100::Parser::new(4, 20, 0);
        restored.process(&snapshot.data);
        assert_eq!(
            restored.screen().contents(),
            terminal.parser.screen().contents()
        );
        assert_eq!(
            restored.screen().cursor_position(),
            terminal.parser.screen().cursor_position()
        );
    }
}
