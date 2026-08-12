import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { sha256Hex } from "../src/lib.js";
import { handleBackupPost, handleBackupGet, handleBackupRevGet } from "../src/handlers.js";

/**
 * In-memory stand-in for the one D1 database this app uses, covering just
 * the query shapes handlers.js issues against `sessions` and `backups` —
 * enough to drive the real conditional-upsert logic in handleBackupPost end
 * to end, not a full D1 emulation. Routes by matching on the SQL text
 * rather than re-implementing a SQL engine.
 * @param {{ userId: string, backup?: { rev: number, createdAt: string, sizeBytes: number, payload: string } }} opts
 */
function fakeEnv({ userId, backup }) {
  /** @type {Map<string, { rev: number, created_at: string, size_bytes: number, payload: string }>} */
  const backupsByUser = new Map();
  if (backup) {
    backupsByUser.set(userId, {
      rev: backup.rev,
      created_at: backup.createdAt,
      size_bytes: backup.sizeBytes,
      payload: backup.payload,
    });
  }

  const sessionTokenHash = sha256Hex("test-token");
  const env = {
    caffe_backups: {
      prepare(/** @type {string} */ sql) {
        return {
          bind(/** @type {unknown[]} */ ...args) {
            return {
              async first() {
                if (sql.includes("FROM sessions")) {
                  const [tokenHash] = args;
                  if (tokenHash !== (await sessionTokenHash)) return null;
                  return {
                    user_id: userId,
                    // Well outside the 48h renewal window, so these tests
                    // don't also have to account for a Set-Cookie renewal.
                    expires_at: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString(),
                  };
                }
                if (sql.startsWith("INSERT INTO backups")) {
                  const [uid, createdAt, sizeBytes, payload, baseRevision] = args;
                  const existing = backupsByUser.get(/** @type {string} */ (uid));
                  if (!existing) {
                    const row = {
                      rev: 1,
                      created_at: /** @type {string} */ (createdAt),
                      size_bytes: /** @type {number} */ (sizeBytes),
                      payload: /** @type {string} */ (payload),
                    };
                    backupsByUser.set(/** @type {string} */ (uid), row);
                    return { rev: 1 };
                  }
                  if (existing.rev !== baseRevision) return null; // WHERE guard fails
                  existing.rev += 1;
                  existing.created_at = /** @type {string} */ (createdAt);
                  existing.size_bytes = /** @type {number} */ (sizeBytes);
                  existing.payload = /** @type {string} */ (payload);
                  return { rev: existing.rev };
                }
                if (sql.startsWith("SELECT rev, created_at, payload FROM backups")) {
                  const [uid] = args;
                  return backupsByUser.get(/** @type {string} */ (uid)) ?? null;
                }
                if (sql.startsWith("SELECT rev, created_at FROM backups")) {
                  const [uid] = args;
                  const row = backupsByUser.get(/** @type {string} */ (uid));
                  return row ? { rev: row.rev, created_at: row.created_at } : null;
                }
                throw new Error(`Unexpected query in test double: ${sql}`);
              },
              async run() {
                // Only ever hit by session renewal, which these tests avoid
                // by keeping expires_at well outside the renewal window.
              },
            };
          },
        };
      },
    },
  };
  return { env, getStoredBackup: () => backupsByUser.get(userId) ?? null };
}

function signedInRequest(url, init = {}) {
  return new Request(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: "session=test-token" },
  });
}

describe("handleBackupPost", () => {
  test("a fresh account's first-ever push succeeds at rev 1", async () => {
    const { env, getStoredBackup } = fakeEnv({ userId: "user-1" });
    const response = await handleBackupPost(
      signedInRequest("https://api.coffee.blut.dev/backup", {
        method: "POST",
        body: JSON.stringify({ baseRevision: 0, backup: { hello: "world" } }),
      }),
      env,
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rev, 1);
    assert.ok(body.createdAt);
    assert.deepEqual(JSON.parse(/** @type {string} */ (getStoredBackup()?.payload)), {
      hello: "world",
    });
  });

  test("a push with the correct baseRevision succeeds and increments rev", async () => {
    const { env, getStoredBackup } = fakeEnv({
      userId: "user-1",
      backup: { rev: 2, createdAt: "2026-01-01T00:00:00.000Z", sizeBytes: 10, payload: '{"old":true}' },
    });

    const response = await handleBackupPost(
      signedInRequest("https://api.coffee.blut.dev/backup", {
        method: "POST",
        body: JSON.stringify({ baseRevision: 2, backup: { updated: true } }),
      }),
      env,
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rev, 3);
    assert.equal(getStoredBackup()?.rev, 3);
    assert.deepEqual(JSON.parse(/** @type {string} */ (getStoredBackup()?.payload)), {
      updated: true,
    });
  });

  test("a push with a stale baseRevision is rejected with 409 and leaves the stored backup untouched", async () => {
    const { env, getStoredBackup } = fakeEnv({
      userId: "user-1",
      backup: { rev: 2, createdAt: "2026-01-01T00:00:00.000Z", sizeBytes: 10, payload: '{"mine":true}' },
    });

    const response = await handleBackupPost(
      signedInRequest("https://api.coffee.blut.dev/backup", {
        method: "POST",
        // This device last saw rev 1, but the stored backup is already at
        // rev 2 (pushed by another device in between) — must be rejected.
        body: JSON.stringify({ baseRevision: 1, backup: { stale: true } }),
      }),
      env,
    );

    assert.equal(response.status, 409);
    assert.equal(getStoredBackup()?.rev, 2);
    assert.deepEqual(JSON.parse(/** @type {string} */ (getStoredBackup()?.payload)), {
      mine: true,
    });
  });

  test("rejects a body missing baseRevision", async () => {
    const { env } = fakeEnv({ userId: "user-1" });
    const response = await handleBackupPost(
      signedInRequest("https://api.coffee.blut.dev/backup", {
        method: "POST",
        body: JSON.stringify({ backup: { hello: "world" } }),
      }),
      env,
    );
    assert.equal(response.status, 400);
  });

  test("rejects a body missing the backup field", async () => {
    const { env } = fakeEnv({ userId: "user-1" });
    const response = await handleBackupPost(
      signedInRequest("https://api.coffee.blut.dev/backup", {
        method: "POST",
        body: JSON.stringify({ baseRevision: 0 }),
      }),
      env,
    );
    assert.equal(response.status, 400);
  });

  test("rejects when not signed in", async () => {
    const { env } = fakeEnv({ userId: "user-1" });
    const response = await handleBackupPost(
      new Request("https://api.coffee.blut.dev/backup", {
        method: "POST",
        body: JSON.stringify({ baseRevision: 0, backup: {} }),
      }),
      env,
    );
    assert.equal(response.status, 401);
  });
});

describe("handleBackupGet", () => {
  test("returns rev, createdAt, and the stored backup unwrapped", async () => {
    const { env } = fakeEnv({
      userId: "user-1",
      backup: {
        rev: 4,
        createdAt: "2026-02-02T00:00:00.000Z",
        sizeBytes: 10,
        payload: '{"roasters":[]}',
      },
    });

    const response = await handleBackupGet(
      signedInRequest("https://api.coffee.blut.dev/backup"),
      env,
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rev, 4);
    assert.equal(body.createdAt, "2026-02-02T00:00:00.000Z");
    assert.deepEqual(body.backup, { roasters: [] });
  });

  test("404s when no backup exists yet", async () => {
    const { env } = fakeEnv({ userId: "user-1" });
    const response = await handleBackupGet(
      signedInRequest("https://api.coffee.blut.dev/backup"),
      env,
    );
    assert.equal(response.status, 404);
  });
});

describe("handleBackupRevGet", () => {
  test("returns just the revision and timestamp, no payload", async () => {
    const { env } = fakeEnv({
      userId: "user-1",
      backup: {
        rev: 7,
        createdAt: "2026-03-03T00:00:00.000Z",
        sizeBytes: 10,
        payload: '{"huge":"blob"}',
      },
    });

    const response = await handleBackupRevGet(
      signedInRequest("https://api.coffee.blut.dev/backup/rev"),
      env,
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rev, 7);
    assert.equal(body.createdAt, "2026-03-03T00:00:00.000Z");
    assert.equal(body.backup, undefined);
  });

  test("404s when no backup exists yet", async () => {
    const { env } = fakeEnv({ userId: "user-1" });
    const response = await handleBackupRevGet(
      signedInRequest("https://api.coffee.blut.dev/backup/rev"),
      env,
    );
    assert.equal(response.status, 404);
  });
});
