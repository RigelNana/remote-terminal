PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE credentials (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    passkey TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
) STRICT;
CREATE INDEX credentials_user ON credentials(user_id);

CREATE TABLE recovery_codes (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    used_at INTEGER
) STRICT;
CREATE INDEX recovery_codes_user ON recovery_codes(user_id, used_at);

CREATE TABLE bootstraps (
    id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
) STRICT;

CREATE TABLE browser_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_hash TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
) STRICT;
CREATE INDEX browser_sessions_user ON browser_sessions(user_id, expires_at);

CREATE TABLE device_flows (
    id TEXT PRIMARY KEY NOT NULL,
    device_hash TEXT NOT NULL UNIQUE,
    user_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    version TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    interval_secs INTEGER NOT NULL,
    last_poll_at INTEGER,
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'denied', 'consumed')),
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX device_flows_expiry ON device_flows(expires_at, status);

CREATE TABLE devices (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    version TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    profiles TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN ('online', 'degraded', 'offline', 'revoked')),
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    revoked_at INTEGER
) STRICT;
CREATE INDEX devices_user ON devices(user_id, status);

CREATE TABLE device_keys (
    id TEXT PRIMARY KEY NOT NULL,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
) STRICT;
CREATE INDEX device_keys_device ON device_keys(device_id, revoked_at);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    profile TEXT NOT NULL,
    cwd TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('starting', 'running', 'exited', 'lost')),
    pid INTEGER,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    exit_code INTEGER,
    reason TEXT,
    idempotency_key TEXT NOT NULL,
    UNIQUE(user_id, idempotency_key)
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id, started_at DESC);
CREATE INDEX sessions_device ON sessions(device_id, state);

CREATE TABLE audit_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor TEXT NOT NULL,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    result TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    previous_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL
) STRICT;
CREATE INDEX audit_user_sequence ON audit_events(user_id, sequence DESC);
