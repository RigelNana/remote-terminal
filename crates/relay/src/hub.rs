use std::sync::Arc;

use bytes::Bytes;
use dashmap::DashMap;
use parking_lot::Mutex;
use remote_proto::{
    id::{AttachId, DeviceId, SessionId, UserId},
    wire::Envelope,
};
use tokio::sync::{RwLock, broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{Error, Result};

#[derive(Clone)]
pub struct Hub {
    queue: usize,
    devices: Arc<DashMap<DeviceId, DeviceLink>>,
    sessions: Arc<DashMap<SessionId, Arc<SessionLink>>>,
}

#[derive(Clone)]
struct DeviceLink {
    generation: Uuid,
    sender: mpsc::Sender<Envelope>,
    cancel: CancellationToken,
}

struct AgentLink {
    generation: Uuid,
    sender: mpsc::Sender<Bytes>,
}

pub struct SessionLink {
    pub id: SessionId,
    pub user: UserId,
    pub device: DeviceId,
    agent: RwLock<Option<AgentLink>>,
    output: broadcast::Sender<Bytes>,
    controller: Mutex<Option<AttachId>>,
}

impl Hub {
    #[must_use]
    pub fn new(queue: usize) -> Self {
        Self {
            queue,
            devices: Arc::new(DashMap::new()),
            sessions: Arc::new(DashMap::new()),
        }
    }

    pub fn online(&self, device: DeviceId) -> (Uuid, mpsc::Receiver<Envelope>, CancellationToken) {
        let (sender, receiver) = mpsc::channel(self.queue);
        let generation = Uuid::now_v7();
        let cancel = CancellationToken::new();
        if let Some(previous) = self.devices.insert(
            device,
            DeviceLink {
                generation,
                sender,
                cancel: cancel.clone(),
            },
        ) {
            previous.cancel.cancel();
        }
        (generation, receiver, cancel)
    }

    pub fn offline(&self, device: DeviceId, generation: Uuid) -> bool {
        if let Some(link) = self.devices.get(&device)
            && link.generation == generation
        {
            drop(link);
            self.devices.remove(&device);
            return true;
        }
        false
    }

    pub fn revoke(&self, device: DeviceId) {
        if let Some((_, link)) = self.devices.remove(&device) {
            link.cancel.cancel();
        }
        let sessions = self
            .sessions
            .iter()
            .filter(|entry| entry.device == device)
            .map(|entry| *entry.key())
            .collect::<Vec<_>>();
        for session in sessions {
            self.sessions.remove(&session);
        }
    }

    #[must_use]
    pub fn online_now(&self, device: DeviceId) -> bool {
        self.devices.contains_key(&device)
    }

    pub async fn send(&self, device: DeviceId, frame: Envelope) -> Result<()> {
        let sender = self
            .devices
            .get(&device)
            .map(|link| link.sender.clone())
            .ok_or(Error::Offline)?;
        sender.send(frame).await.map_err(|_| Error::Offline)
    }

    pub fn create_session(
        &self,
        id: SessionId,
        user: UserId,
        device: DeviceId,
    ) -> Arc<SessionLink> {
        self.sessions
            .entry(id)
            .or_insert_with(|| Arc::new(SessionLink::new(id, user, device, self.queue)))
            .clone()
    }

    pub fn session(&self, id: SessionId) -> Result<Arc<SessionLink>> {
        self.sessions
            .get(&id)
            .map(|entry| entry.clone())
            .ok_or(Error::NotFound)
    }

    pub fn remove_session(&self, id: SessionId) {
        self.sessions.remove(&id);
    }
}

impl SessionLink {
    fn new(id: SessionId, user: UserId, device: DeviceId, queue: usize) -> Self {
        let (output, _) = broadcast::channel(queue);
        Self {
            id,
            user,
            device,
            agent: RwLock::new(None),
            output,
            controller: Mutex::new(None),
        }
    }

    pub async fn bind_agent(&self, sender: mpsc::Sender<Bytes>) -> Uuid {
        let generation = Uuid::now_v7();
        *self.agent.write().await = Some(AgentLink { generation, sender });
        generation
    }

    pub async fn unbind_agent(&self, generation: Uuid) {
        let mut agent = self.agent.write().await;
        if agent
            .as_ref()
            .is_some_and(|link| link.generation == generation)
        {
            *agent = None;
        }
    }
    pub async fn agent_current(&self, generation: Uuid) -> bool {
        self.agent
            .read()
            .await
            .as_ref()
            .is_some_and(|link| link.generation == generation)
    }

    pub async fn send_agent(&self, frame: Bytes) -> Result<()> {
        let sender = self
            .agent
            .read()
            .await
            .as_ref()
            .map(|link| link.sender.clone())
            .ok_or(Error::Offline)?;
        sender.send(frame).await.map_err(|_| Error::Offline)
    }

    pub fn publish(&self, frame: Bytes) {
        let _ = self.output.send(frame);
    }

    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<Bytes> {
        self.output.subscribe()
    }

    #[must_use]
    pub fn acquire(&self, attach: AttachId) -> bool {
        let mut controller = self.controller.lock();
        if controller.is_none() {
            *controller = Some(attach);
            true
        } else {
            controller.is_some_and(|current| current == attach)
        }
    }

    pub fn release(&self, attach: AttachId) {
        let mut controller = self.controller.lock();
        if controller.is_some_and(|current| current == attach) {
            *controller = None;
        }
    }

    #[must_use]
    pub fn controls(&self, attach: AttachId) -> bool {
        self.controller
            .lock()
            .is_some_and(|current| current == attach)
    }
}
