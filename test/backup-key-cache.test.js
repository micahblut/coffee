import "fake-indexeddb/auto";
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { db } from "../src/db/db.js";
import {
  getCachedBackupKey,
  cacheBackupKey,
  clearCachedBackupKey,
} from "../src/sync/backup-key-cache.js";

/**
 * @returns {Promise<CryptoKey>}
 */
function fakeCryptoKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypts and decrypts a fixed message with the given key — a functional
 * check that a key round-tripped through Dexie is still genuinely usable,
 * since reference equality doesn't apply once it's gone through storage.
 * @param {CryptoKey} key
 */
async function roundTripsWith(key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode("hello");
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted) === "hello";
}

afterEach(async () => {
  await clearCachedBackupKey();
});

describe("cacheBackupKey / getCachedBackupKey", () => {
  test("round-trips a real non-extractable CryptoKey", async () => {
    const key = await fakeCryptoKey();
    await cacheBackupKey(key);

    const cached = await getCachedBackupKey();
    assert.ok(cached);
    assert.equal(cached.extractable, false);
    assert.ok(await roundTripsWith(cached));

    const row = await db.cryptoKeys.get("backup-key");
    assert.ok(row?.key instanceof CryptoKey);
  });

  test("clearCachedBackupKey removes it from memory and Dexie", async () => {
    await cacheBackupKey(await fakeCryptoKey());
    await clearCachedBackupKey();

    assert.equal(await getCachedBackupKey(), null);
    assert.equal(await db.cryptoKeys.get("backup-key"), undefined);
  });

  test("getCachedBackupKey resolves to null (never throws) when the Dexie read fails", async () => {
    const table = /** @type {any} */ (db.cryptoKeys);
    const originalGet = table.get.bind(table);
    table.get = async () => {
      throw new Error("IndexedDB unavailable");
    };
    try {
      assert.equal(await getCachedBackupKey(), null);
    } finally {
      table.get = originalGet;
    }
  });
});
