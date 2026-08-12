import "fake-indexeddb/auto";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Node's own global localStorage needs an on-disk file opted into via a CLI
// flag we don't otherwise need — session.js just wants something that
// implements the Web Storage interface, so a plain in-memory stub suffices.
const fakeLocalStorageStore = /** @type {Map<string, string>} */ (new Map());
globalThis.localStorage = /** @type {Storage} */ ({
  getItem(/** @type {string} */ key) {
    return fakeLocalStorageStore.get(key) ?? null;
  },
  setItem(/** @type {string} */ key, /** @type {string} */ value) {
    fakeLocalStorageStore.set(key, String(value));
  },
  removeItem(/** @type {string} */ key) {
    fakeLocalStorageStore.delete(key);
  },
});

import { db } from "../src/db/db.js";
import { refreshSessionState, clearSessionState, isSignedIn } from "../src/sync/session.js";
import {
  startAutoSync,
  stopAutoSync,
  getSyncStatus,
  syncNow,
  reconcileWithCloud,
} from "../src/sync/auto-sync.js";
import {
  backupNow,
  restoreFromCloud,
  acknowledgeRemoteRevision,
  getKnownRevision,
  isDirty,
  markDirty,
  resetRemoteBackupFormatCache,
  BackupLockedError,
  BackupConflictError,
  BackupDecryptError,
} from "../src/sync/backup.js";
import { cacheBackupKey, clearCachedBackupKey } from "../src/sync/backup-key-cache.js";
import { deriveKeyFromPrfSecret, encryptBackupPayload } from "../src/sync/backup-crypto.js";

const originalFetch = globalThis.fetch;

/**
 * Routes fetch calls by "METHOD /path" to a canned Response, and records
 * every call made (plus its parsed JSON body, for POSTs) — the one seam
 * this app's cloud code talks to the network through, so stubbing it
 * exercises the real session/backup/api modules end to end without
 * touching a real server.
 * @param {Record<string, () => Response>} responses
 */
function fakeFetch(responses) {
  /** @type {string[]} */
  const calls = [];
  /** @type {unknown[]} */
  const bodies = [];
  const fn = /** @type {typeof fetch & { calls: string[], bodies: unknown[] }} */ (
    async (/** @type {string} */ url, /** @type {RequestInit} */ options = {}) => {
      const path = new URL(url).pathname;
      const key = `${options.method ?? "GET"} ${path}`;
      calls.push(key);
      bodies.push(typeof options.body === "string" ? JSON.parse(options.body) : undefined);
      const respond = responses[key];
      if (!respond) throw new Error(`Unexpected fetch: ${key}`);
      return respond();
    }
  );
  fn.calls = calls;
  fn.bodies = bodies;
  return fn;
}

/**
 * @param {unknown} body
 */
function okJson(body) {
  return () => new Response(JSON.stringify(body), { status: 200 });
}

/**
 * @param {number} rev
 */
function pushOkJson(rev) {
  return okJson({ rev, createdAt: new Date().toISOString() });
}

/**
 * @param {number} rev
 * @param {unknown} backup
 */
function pullOkJson(rev, backup) {
  return okJson({ rev, createdAt: new Date().toISOString(), backup });
}

function notFoundJson() {
  return () => new Response(JSON.stringify({ error: "No backup found" }), { status: 404 });
}

function conflictJson() {
  return () => new Response(JSON.stringify({ error: "Backup is out of date" }), { status: 409 });
}

/**
 * @returns {ArrayBuffer} a fake 32-byte PRF secret
 */
function fakePrfSecret() {
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

beforeEach(async () => {
  await Promise.all([
    db.roasters.clear(),
    db.bags.clear(),
    db.grinders.clear(),
    db.brewers.clear(),
    db.brews.clear(),
    db.settings.clear(),
  ]);
});

afterEach(async () => {
  stopAutoSync();
  clearSessionState();
  await clearCachedBackupKey();
  resetRemoteBackupFormatCache();
  globalThis.fetch = originalFetch;
});

describe("syncNow", () => {
  test("pushes a backup and marks the shared status synced", async () => {
    globalThis.fetch = fakeFetch({
      "GET /backup": notFoundJson(),
      "POST /backup": pushOkJson(1),
    });

    await syncNow();

    const { status, lastSyncedAt } = getSyncStatus();
    assert.equal(status, "synced");
    assert.ok(lastSyncedAt instanceof Date);
    assert.equal(getKnownRevision(), 1);
    assert.equal(isDirty(), false);
  });

  test("marks status error and rethrows when the push fails", async () => {
    globalThis.fetch = fakeFetch({
      "GET /backup": notFoundJson(),
      "POST /backup": () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
    });

    await assert.rejects(() => syncNow());
    assert.equal(getSyncStatus().status, "error");
  });

  test("encrypts the push when a backup encryption key is cached and no remote backup exists yet", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    await cacheBackupKey(key);

    const fetch = fakeFetch({
      "GET /backup": notFoundJson(),
      "POST /backup": pushOkJson(1),
    });
    globalThis.fetch = fetch;

    await syncNow();

    assert.equal(getSyncStatus().status, "synced");
    const pushedBody = /** @type {any} */ (fetch.bodies[fetch.calls.indexOf("POST /backup")]);
    assert.equal(pushedBody.baseRevision, 0);
    assert.equal(pushedBody.backup.encrypted, true);
    assert.equal(typeof pushedBody.backup.iv, "string");
    assert.equal(typeof pushedBody.backup.ciphertext, "string");
  });

  test("sets status locked and never pushes when the remote backup is encrypted and no key is cached", async () => {
    const remoteKey = await deriveKeyFromPrfSecret(fakePrfSecret());
    const remoteEnvelope = await encryptBackupPayload(remoteKey, { exportVersion: 1, brews: [] });

    const fetch = fakeFetch({
      "GET /backup": pullOkJson(1, remoteEnvelope),
    });
    globalThis.fetch = fetch;

    await assert.rejects(() => syncNow(), BackupLockedError);
    assert.equal(getSyncStatus().status, "locked");
    assert.equal(fetch.calls.includes("POST /backup"), false);
  });

  test("sets status conflict, doesn't adopt the stale revision, and rethrows when the push is rejected", async () => {
    globalThis.fetch = fakeFetch({
      "GET /backup": notFoundJson(),
      "POST /backup": conflictJson(),
    });

    await assert.rejects(() => syncNow(), BackupConflictError);
    assert.equal(getSyncStatus().status, "conflict");
    // Still 0 — a conflict must not self-heal the locally-known revision,
    // or the very next local edit's auto-push would succeed and silently
    // overwrite whatever the other device just pushed.
    assert.equal(getKnownRevision(), 0);
  });
});

describe("startAutoSync / stopAutoSync", () => {
  test("syncs immediately on start", async () => {
    const fetch = fakeFetch({
      "GET /backup": notFoundJson(),
      "POST /backup": pushOkJson(1),
    });
    globalThis.fetch = fetch;

    startAutoSync();
    // startAutoSync's initial sync isn't awaited internally by design (fire
    // on start, don't block the caller) — give the real async chain (fake
    // IndexedDB reads, then the stubbed fetch) time to actually finish.
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(fetch.calls.filter((c) => c === "POST /backup").length, 1);
    assert.equal(getSyncStatus().status, "synced");
  });

  test("a write after stopAutoSync doesn't trigger a push", async () => {
    globalThis.fetch = fakeFetch({
      "GET /session": okJson({ userId: "user-1" }),
      "GET /backup": notFoundJson(),
      "POST /backup": pushOkJson(1),
    });
    await refreshSessionState();
    assert.equal(isSignedIn(), true);

    startAutoSync();
    // Let the initial sync-on-start fully finish before swapping the fetch
    // stub below — otherwise it can resolve late against the *new* stub and
    // leak an extra call into this test's "zero calls" assertion.
    await new Promise((resolve) => setTimeout(resolve, 100));
    stopAutoSync();

    const fetch = fakeFetch({});
    globalThis.fetch = fetch;
    await db.roasters.add({ id: "r1", name: "Test Roaster" });
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(fetch.calls.length, 0);
  });
});

describe("debounced auto-sync on local writes", () => {
  test("a write while signed in and listening triggers a backup after the debounce window", async () => {
    globalThis.fetch = fakeFetch({
      "GET /session": okJson({ userId: "user-1" }),
      "GET /backup": notFoundJson(),
      "POST /backup": pushOkJson(1),
    });
    await refreshSessionState();

    startAutoSync();
    // Same reasoning as above — let the initial sync-on-start finish before
    // swapping the stub, so it can't leak a late call into the count below.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const fetch = fakeFetch({
      "POST /backup": pushOkJson(2),
    });
    globalThis.fetch = fetch;

    await db.roasters.add({ id: "r2", name: "Debounced Roaster" });
    assert.equal(getSyncStatus().status, "pending");
    assert.equal(isDirty(), true);

    // The debounce window is 4s; wait past it rather than mocking timers,
    // since Dexie's own storagemutated propagation would be mocked too.
    await new Promise((resolve) => setTimeout(resolve, 4300));

    assert.equal(fetch.calls.filter((c) => c === "POST /backup").length, 1);
    assert.equal(getSyncStatus().status, "synced");
    assert.equal(isDirty(), false);
  });
});

describe("backupNow", () => {
  test("stays plaintext when no backup encryption key is cached", async () => {
    const fetch = fakeFetch({
      "GET /backup": notFoundJson(),
      "POST /backup": pushOkJson(1),
    });
    globalThis.fetch = fetch;

    await backupNow();

    const pushedBody = /** @type {any} */ (fetch.bodies[fetch.calls.indexOf("POST /backup")]);
    assert.equal(pushedBody.baseRevision, 0);
    assert.equal(pushedBody.backup.encrypted, undefined);
    assert.equal(pushedBody.backup.exportVersion, 1);
  });

  test("a subsequent push after a conflict uses the base revision it already knew, still failing until acknowledged", async () => {
    globalThis.fetch = fakeFetch({
      "GET /backup": notFoundJson(),
      "POST /backup": conflictJson(),
    });
    await assert.rejects(() => backupNow(), BackupConflictError);

    const fetch = fakeFetch({ "POST /backup": conflictJson() });
    globalThis.fetch = fetch;
    await assert.rejects(() => backupNow(), BackupConflictError);
    assert.equal(
      /** @type {any} */ (fetch.bodies[fetch.calls.indexOf("POST /backup")]).baseRevision,
      0,
    );
  });
});

describe("acknowledgeRemoteRevision", () => {
  test("updates the known revision without importing any data", async () => {
    globalThis.fetch = fakeFetch({
      "GET /backup/rev": okJson({ rev: 5, createdAt: new Date().toISOString() }),
    });

    await db.roasters.add({ id: "local-only", name: "Local Roaster" });
    await acknowledgeRemoteRevision();

    assert.equal(getKnownRevision(), 5);
    const roasters = await db.roasters.toArray();
    assert.deepEqual(
      roasters.map((r) => r.id),
      ["local-only"],
    );
  });

  test("lets a retried push succeed after a conflict, overwriting the cloud with this device's data", async () => {
    globalThis.fetch = fakeFetch({
      "GET /backup": notFoundJson(),
      "POST /backup": conflictJson(),
    });
    await assert.rejects(() => syncNow(), BackupConflictError);

    globalThis.fetch = fakeFetch({
      "GET /backup/rev": okJson({ rev: 3, createdAt: new Date().toISOString() }),
      "POST /backup": pushOkJson(4),
    });
    await acknowledgeRemoteRevision();
    assert.equal(getKnownRevision(), 3);

    await syncNow();
    assert.equal(getSyncStatus().status, "synced");
    assert.equal(getKnownRevision(), 4);
  });
});

describe("reconcileWithCloud", () => {
  test("does nothing when signed out", async () => {
    const fetch = fakeFetch({});
    globalThis.fetch = fetch;
    await reconcileWithCloud();
    assert.equal(fetch.calls.length, 0);
  });

  test("does nothing when this device has unconfirmed local changes", async () => {
    globalThis.fetch = fakeFetch({ "GET /session": okJson({ userId: "user-1" }) });
    await refreshSessionState();
    markDirty();

    const fetch = fakeFetch({});
    globalThis.fetch = fetch;
    await reconcileWithCloud();
    assert.equal(fetch.calls.length, 0);
  });

  test("does nothing when it's never synced yet but already has real local data", async () => {
    globalThis.fetch = fakeFetch({ "GET /session": okJson({ userId: "user-1" }) });
    await refreshSessionState();
    await db.roasters.add({ id: "r1", name: "Pre-existing Roaster" });

    const fetch = fakeFetch({});
    globalThis.fetch = fetch;
    await reconcileWithCloud();
    assert.equal(fetch.calls.length, 0);
  });

  test("pulls when clean and the cloud is ahead of what's known", async () => {
    globalThis.fetch = fakeFetch({ "GET /session": okJson({ userId: "user-1" }) });
    await refreshSessionState();

    const plain = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: [],
      grinders: [],
      brewers: [],
      roasters: [{ id: "cloud-r1", name: "Cloud Roaster" }],
      bags: [],
      brews: [],
    };
    const fetch = fakeFetch({
      "GET /backup/rev": okJson({ rev: 2, createdAt: new Date().toISOString() }),
      "GET /backup": pullOkJson(2, plain),
    });
    globalThis.fetch = fetch;

    await reconcileWithCloud();

    assert.equal(getKnownRevision(), 2);
    const roasters = await db.roasters.toArray();
    assert.deepEqual(roasters, plain.roasters);
  });

  test("does nothing when clean and already current", async () => {
    globalThis.fetch = fakeFetch({ "GET /session": okJson({ userId: "user-1" }) });
    await refreshSessionState();
    await seedKnownRevision(3);

    const fetch = fakeFetch({
      "GET /backup/rev": okJson({ rev: 3, createdAt: new Date().toISOString() }),
    });
    globalThis.fetch = fetch;

    await reconcileWithCloud();

    // Asserting the exact call list (not just "no GET /backup") so a bug
    // that tried to pull anyway wouldn't be masked by reconcileWithCloud's
    // own best-effort try/catch swallowing the resulting "unexpected fetch"
    // error from the stub.
    assert.deepEqual(fetch.calls, ["GET /backup/rev"]);
  });

  /**
   * Test-only shortcut to seed a known revision without a real pull.
   * @param {number} rev
   */
  async function seedKnownRevision(rev) {
    globalThis.fetch = fakeFetch({
      "GET /backup/rev": okJson({ rev, createdAt: new Date().toISOString() }),
    });
    await acknowledgeRemoteRevision();
  }
});

describe("restoreFromCloud", () => {
  test("decrypts and imports an encrypted backup with the right cached key", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    await cacheBackupKey(key);

    const plain = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: [],
      grinders: [],
      brewers: [],
      roasters: [{ id: "r1", name: "Restored Roaster" }],
      bags: [],
      brews: [],
    };
    const envelope = await encryptBackupPayload(key, plain);

    globalThis.fetch = fakeFetch({ "GET /backup": pullOkJson(1, envelope) });

    await restoreFromCloud();

    const roasters = await db.roasters.toArray();
    assert.deepEqual(roasters, plain.roasters);
    assert.equal(getKnownRevision(), 1);
    assert.equal(isDirty(), false);
  });

  test("throws BackupDecryptError when no key is cached for an encrypted backup", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    const envelope = await encryptBackupPayload(key, { exportVersion: 1, roasters: [] });

    globalThis.fetch = fakeFetch({ "GET /backup": pullOkJson(1, envelope) });

    await assert.rejects(() => restoreFromCloud(), BackupDecryptError);
  });

  test("throws BackupDecryptError when the cached key doesn't match", async () => {
    const rightKey = await deriveKeyFromPrfSecret(fakePrfSecret());
    const wrongKey = await deriveKeyFromPrfSecret(fakePrfSecret());
    await cacheBackupKey(wrongKey);

    const envelope = await encryptBackupPayload(rightKey, { exportVersion: 1, roasters: [] });
    globalThis.fetch = fakeFetch({ "GET /backup": pullOkJson(1, envelope) });

    await assert.rejects(() => restoreFromCloud(), BackupDecryptError);
  });

  test("resolves a conflict status back to idle", async () => {
    globalThis.fetch = fakeFetch({
      "GET /backup": notFoundJson(),
      "POST /backup": conflictJson(),
    });
    await assert.rejects(() => syncNow(), BackupConflictError);
    assert.equal(getSyncStatus().status, "conflict");

    globalThis.fetch = fakeFetch({
      "GET /backup": pullOkJson(2, {
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        settings: [],
        grinders: [],
        brewers: [],
        roasters: [],
        bags: [],
        brews: [],
      }),
    });
    await restoreFromCloud();

    assert.equal(getSyncStatus().status, "idle");
  });
});
