use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

#[must_use]
pub fn token() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}

#[must_use]
pub fn short() -> String {
    let encoded = data_encoding::BASE32_NOPAD.encode(&rand::random::<[u8; 10]>());
    format!("{}-{}", &encoded[..8], &encoded[8..16])
}

#[must_use]
pub fn hash(value: &str) -> String {
    blake3::hash(value.as_bytes()).to_hex().to_string()
}
