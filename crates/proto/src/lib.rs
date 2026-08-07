pub mod id;

use bytes::Bytes;
use prost::Message;
use thiserror::Error;

pub mod wire {
    include!(concat!(env!("OUT_DIR"), "/remote.v1.rs"));
}

pub const VERSION: u32 = 1;
pub const MAX_FRAME: usize = 256 * 1024;

#[derive(Debug, Error)]
pub enum Error {
    #[error("protocol frame exceeds {MAX_FRAME} bytes")]
    TooLarge,
    #[error("invalid protocol frame: {0}")]
    Decode(#[from] prost::DecodeError),
    #[error("unsupported protocol version {0}")]
    Version(u32),
    #[error("protocol frame has no body")]
    Empty,
}

impl wire::Envelope {
    #[must_use]
    pub fn frame(session: impl Into<String>, body: wire::envelope::Body) -> Self {
        Self {
            version: VERSION,
            session: session.into(),
            body: Some(body),
        }
    }

    pub fn encode_frame(&self) -> Result<Bytes, Error> {
        if self.encoded_len() > MAX_FRAME {
            return Err(Error::TooLarge);
        }
        Ok(Bytes::from(self.encode_to_vec()))
    }

    pub fn decode_frame(data: impl AsRef<[u8]>) -> Result<Self, Error> {
        let data = data.as_ref();
        if data.len() > MAX_FRAME {
            return Err(Error::TooLarge);
        }
        let frame = Self::decode(data)?;
        if frame.version != VERSION {
            return Err(Error::Version(frame.version));
        }
        if frame.body.is_none() {
            return Err(Error::Empty);
        }
        Ok(frame)
    }
}
