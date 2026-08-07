use std::sync::Arc;

use dashmap::DashMap;
use remote_proto::id::{AttachId, DeviceId, SessionId, UserId};

use crate::{
    error::{Error, Result},
    model::now,
    secret,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Kind {
    Agent,
    Browser,
}

#[derive(Clone, Copy, Debug)]
pub struct Claim {
    pub kind: Kind,
    pub user: UserId,
    pub device: DeviceId,
    pub session: SessionId,
    pub attach: Option<AttachId>,
    pub expires_at: i64,
}

#[derive(Clone, Default)]
pub struct Tickets {
    claims: Arc<DashMap<String, Claim>>,
}

impl Tickets {
    #[must_use]
    pub fn issue(&self, mut claim: Claim, ttl: i64) -> String {
        self.prune();
        let token = secret::token();
        claim.expires_at = now() + ttl;
        self.claims.insert(secret::hash(&token), claim);
        token
    }

    pub fn consume(&self, token: &str, kind: Kind) -> Result<Claim> {
        let (_, claim) = self
            .claims
            .remove(&secret::hash(token))
            .ok_or(Error::Authentication)?;
        if claim.kind != kind {
            return Err(Error::Forbidden);
        }
        if claim.expires_at <= now() {
            return Err(Error::Expired);
        }
        Ok(claim)
    }

    fn prune(&self) {
        let current = now();
        self.claims.retain(|_, claim| claim.expires_at > current);
    }
}
