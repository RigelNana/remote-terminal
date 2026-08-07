use std::collections::VecDeque;

use bytes::Bytes;

#[derive(Clone, Debug)]
pub struct Chunk {
    pub start: u64,
    pub end: u64,
    pub data: Bytes,
}

pub struct Replay {
    pub available_start: u64,
    pub requested_start: u64,
    pub chunks: Vec<Chunk>,
}

pub struct Journal {
    capacity: usize,
    bytes: usize,
    start: u64,
    end: u64,
    chunks: VecDeque<Chunk>,
}

impl Journal {
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            bytes: 0,
            start: 0,
            end: 0,
            chunks: VecDeque::new(),
        }
    }

    pub fn push(&mut self, data: Bytes) -> Chunk {
        let output_start = self.end;
        self.end = self
            .end
            .saturating_add(u64::try_from(data.len()).unwrap_or(u64::MAX));
        let output = Chunk {
            start: output_start,
            end: self.end,
            data: data.clone(),
        };
        if data.len() >= self.capacity {
            let keep = data.slice(data.len() - self.capacity..);
            self.chunks.clear();
            self.bytes = keep.len();
            self.start = self.end - u64::try_from(keep.len()).unwrap_or(0);
            self.chunks.push_back(Chunk {
                start: self.start,
                end: self.end,
                data: keep,
            });
            return output;
        }
        self.bytes += data.len();
        self.chunks.push_back(output.clone());
        while self.bytes > self.capacity {
            let Some(front) = self.chunks.pop_front() else {
                break;
            };
            self.bytes = self.bytes.saturating_sub(front.data.len());
            self.start = front.end;
        }
        output
    }

    #[must_use]
    pub fn replay(&self, requested: u64) -> Replay {
        let from = requested.max(self.start).min(self.end);
        let chunks = self
            .chunks
            .iter()
            .filter_map(|chunk| {
                if chunk.end <= from {
                    return None;
                }
                if chunk.start < from {
                    let skip = usize::try_from(from - chunk.start).ok()?;
                    return Some(Chunk {
                        start: from,
                        end: chunk.end,
                        data: chunk.data.slice(skip..),
                    });
                }
                Some(chunk.clone())
            })
            .collect();
        Replay {
            available_start: self.start,
            requested_start: requested,
            chunks,
        }
    }

    #[must_use]
    pub const fn end(&self) -> u64 {
        self.end
    }
}
