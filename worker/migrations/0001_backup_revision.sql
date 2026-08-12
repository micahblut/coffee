-- Adds optimistic-concurrency revision tracking to backups, and makes
-- user_id the actual uniqueness constraint now that "latest-only per user"
-- is enforced by the app logic anyway. SQLite can't change a primary key
-- in place, so rebuild-and-copy. Existing rows start at rev 1.
CREATE TABLE backups_new (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  rev INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  payload TEXT NOT NULL
);

INSERT INTO backups_new (user_id, rev, created_at, size_bytes, payload)
  SELECT user_id, 1, created_at, size_bytes, payload FROM backups;

DROP TABLE backups;
ALTER TABLE backups_new RENAME TO backups;

CREATE INDEX idx_backups_user_created ON backups (user_id, created_at DESC);
