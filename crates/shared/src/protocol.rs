use crate::types::AgentState;

pub struct ByteWriter {
    pub buf: Vec<u8>,
}

impl ByteWriter {
    pub fn new(initial: usize) -> Self {
        Self {
            buf: Vec::with_capacity(initial),
        }
    }

    pub fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }

    pub fn u16(&mut self, v: u16) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    pub fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    pub fn f32(&mut self, v: f32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    pub fn varint(&mut self, mut value: u32) {
        while value >= 0x80 {
            self.buf.push(((value & 0x7f) | 0x80) as u8);
            value >>= 7;
        }
        self.buf.push(value as u8);
    }

    pub fn bytes(&mut self, b: &[u8]) {
        self.buf.extend_from_slice(b);
    }

    pub fn patch_u16(&mut self, offset: usize, value: u16) {
        let bytes = value.to_le_bytes();
        self.buf[offset] = bytes[0];
        self.buf[offset + 1] = bytes[1];
    }

    pub fn finish(&self) -> &[u8] {
        &self.buf
    }

    pub fn into_vec(self) -> Vec<u8> {
        self.buf
    }
}

pub struct ByteReader<'a> {
    buf: &'a [u8],
    pub off: usize,
}

impl<'a> ByteReader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, off: 0 }
    }

    pub fn u8(&mut self) -> u8 {
        let v = self.buf[self.off];
        self.off += 1;
        v
    }

    pub fn u16(&mut self) -> u16 {
        let v = u16::from_le_bytes([self.buf[self.off], self.buf[self.off + 1]]);
        self.off += 2;
        v
    }

    pub fn u32(&mut self) -> u32 {
        let v = u32::from_le_bytes([
            self.buf[self.off],
            self.buf[self.off + 1],
            self.buf[self.off + 2],
            self.buf[self.off + 3],
        ]);
        self.off += 4;
        v
    }

    pub fn f32(&mut self) -> f32 {
        let v = f32::from_le_bytes([
            self.buf[self.off],
            self.buf[self.off + 1],
            self.buf[self.off + 2],
            self.buf[self.off + 3],
        ]);
        self.off += 4;
        v
    }

    pub fn varint(&mut self) -> u32 {
        let mut result: u32 = 0;
        let mut shift = 0;
        loop {
            let b = self.buf[self.off];
            self.off += 1;
            result |= ((b & 0x7f) as u32) << shift;
            shift += 7;
            if b & 0x80 == 0 {
                break;
            }
        }
        result
    }

    pub fn remaining(&self) -> usize {
        self.buf.len() - self.off
    }
}

use crate::constants::FIXED_POINT;

pub fn pack_agent(w: &mut ByteWriter, prev_id: u32, a: &AgentState) {
    w.varint(a.id.wrapping_sub(prev_id));
    w.varint((a.x * FIXED_POINT as f64).round() as u32);
    w.varint((a.y * FIXED_POINT as f64).round() as u32);
    w.u8((a.energy * 255.0).round().max(0.0).min(255.0) as u8);
    w.u8(a.state);
    w.u32(a.species);
    w.u8(((a.meme * 255.0).round().max(0.0).min(255.0)) as u8);
}

pub fn encode_delta(tick: u32, agents: &[AgentState]) -> Vec<u8> {
    let mut sorted: Vec<&AgentState> = agents.iter().collect();
    sorted.sort_by_key(|a| a.id);
    let mut w = ByteWriter::new(16 + sorted.len() * 8);
    w.u8(crate::constants::MT_DELTA);
    w.u32(tick);
    w.u16(sorted.len() as u16);
    let mut prev_id = 0u32;
    for a in &sorted {
        pack_agent(&mut w, prev_id, a);
        prev_id = a.id;
    }
    w.into_vec()
}

pub fn read_agents(r: &mut ByteReader, count: u16) -> Vec<AgentState> {
    let mut out = Vec::with_capacity(count as usize);
    let mut id = 0u32;
    for _ in 0..count {
        id = id.wrapping_add(r.varint());
        let x = r.varint() as f64 / FIXED_POINT as f64;
        let y = r.varint() as f64 / FIXED_POINT as f64;
        let energy = r.u8() as f32 / 255.0;
        let state = r.u8();
        let species = r.u32();
        let meme = r.u8() as f32 / 255.0;
        out.push(AgentState {
            id,
            x,
            y,
            energy,
            state,
            species,
            meme,
        });
    }
    out
}
