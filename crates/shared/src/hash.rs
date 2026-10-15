/// FNV-1a 32-bit hash
pub fn fnv1a32(input: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for byte in input.bytes() {
        h ^= byte as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

pub fn u32hex(v: u32) -> String {
    format!("{:08x}", v)
}

/// Hash a float slice into a single u32 (for state hashing / determinism checks)
pub fn hash_floats(values: &[f32], seed: u32) -> u32 {
    let mut h = seed ^ 0x811c9dc5;
    for (i, &v) in values.iter().enumerate() {
        let b = v.to_bits();
        h ^= b;
        h = h.wrapping_mul(0x01000193);
        h ^= (i as u32) + 1;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

pub fn hash_numbers(values: &[u32]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &v in values {
        h ^= v;
        h = h.wrapping_mul(0x01000193);
    }
    h
}
