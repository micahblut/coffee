import "fake-indexeddb/auto";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { db } from "../src/db/db.js";
import { refreshSessionState, clearSessionState, isSignedIn } from "../src/sync/session.js";
import { startAutoSync, stopAutoSync, getSyncStatus, syncNow } from "../src/sync/auto-sync.js";

const originalFetch = globalThis.fetch;

/**
 * Routes fetch calls by "METHOD /path" to a canned Response, and records
 * every call made — the one seam this app's cloud code talks to the
 * network through, so stubbing it exercises the real session/backup/api
 * modules end to end without touching a real server.
 * @param {Record<string, () => Response>} responses
 */
function fakeFetch(responses) {
  /** @type {string[]} */
  const calls = [];
  const fn = /** @type {typeof fetch & { calls: string[] }} */ (
    async (/** @type {string} */ url, /** @type {RequestInit} */ options = {}) => {
      const path = new URL(url).pathname;
      const key = `${options.method ?? "GET"} ${path}`;
      calls.push(key);
      const respond = responses[key];
      if (!respond) throw new Error(`Unexpected fetch: ${key}`);
      return respond();
    }
  );
  fn.calls = calls;
  return fn;
}

/**
 * @param {unknown} body
 */
function okJson(body) {
  return () => new Response(JSON.stringify(body), { status: 200 });
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

afterEach(() => {
  stopAutoSync();
  clearSessionState();
  globalThis.fetch = originalFetch;
});

describe("syncNow", () => {
  test("pushes a backup and marks the shared status synced", async () => {
    globalThis.fetch = fakeFetch({
      "POST /backup": okJson({ createdAt: new Date().toISOString() }),
    });

    await syncNow();

    const { status, lastSyncedAt } = getSyncStatus();
    assert.equal(status, "synced");
    assert.ok(lastSyncedAt instanceof Date);
  });

  test("marks status error and rethrows when the push fails", async () => {
    globalThis.fetch = fakeFetch({
      "POST /backup": () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
    });

    await assert.rejects(() => syncNow());
    assert.equal(getSyncStatus().status, "error");
  });
});

describe("startAutoSync / stopAutoSync", () => {
  test("syncs immediately on start", async () => {
    const fetch = fakeFetch({
      "POST /backup": okJson({ createdAt: new Date().toISOString() }),
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
      "POST /backup": okJson({ createdAt: new Date().toISOString() }),
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
      "POST /backup": okJson({ createdAt: new Date().toISOString() }),
    });
    await refreshSessionState();

    startAutoSync();
    // Same reasoning as above — let the initial sync-on-start finish before
    // swapping the stub, so it can't leak a late call into the count below.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const fetch = fakeFetch({
      "POST /backup": okJson({ createdAt: new Date().toISOString() }),
    });
    globalThis.fetch = fetch;

    await db.roasters.add({ id: "r2", name: "Debounced Roaster" });
    assert.equal(getSyncStatus().status, "pending");

    // The debounce window is 4s; wait past it rather than mocking timers,
    // since Dexie's own storagemutated propagation would be mocked too.
    await new Promise((resolve) => setTimeout(resolve, 4300));

    assert.equal(fetch.calls.filter((c) => c === "POST /backup").length, 1);
    assert.equal(getSyncStatus().status, "synced");
  });
});
