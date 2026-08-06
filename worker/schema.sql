CREATE TABLE invite_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,   -- SHA-256(code + server salt)
  label TEXT,                        -- admin-only note, never shown to users
  max_uses INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,               -- == Passwordless.dev userId
  invite_code_id TEXT REFERENCES invite_codes(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,       -- SHA-256 of the session cookie value
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE backups (               -- latest-only per user for v1
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  payload TEXT NOT NULL              -- JSON.stringify(exportAllData()) verbatim
);
CREATE INDEX idx_backups_user_created ON backups (user_id, created_at DESC);

CREATE TABLE rate_limit_counters (
  bucket_key TEXT PRIMARY KEY,       -- e.g. "register:iphash:<hash>:2026080611"
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);
