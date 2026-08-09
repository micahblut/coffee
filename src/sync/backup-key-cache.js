import { db } from "../db/db.js";

const ROW_ID = "backup-key";

/** @type {CryptoKey | null} */
let inMemoryKey = null;

/**
 * Returns the cached backup encryption key, or null if none is available.
 * Never throws — IndexedDB unavailability, private-browsing quirks, or any
 * other storage failure just means "not cached," not a broken sync.
 * @returns {Promise<CryptoKey | null>}
 */
export async function getCachedBackupKey() {
  if (inMemoryKey) return inMemoryKey;
  try {
    const row = await db.cryptoKeys.get(ROW_ID);
    if (row) inMemoryKey = row.key;
    return inMemoryKey;
  } catch {
    return null;
  }
}

/**
 * @param {CryptoKey} key
 * @returns {Promise<void>}
 */
export async function cacheBackupKey(key) {
  inMemoryKey = key;
  try {
    await db.cryptoKeys.put({ id: ROW_ID, key, cachedAt: new Date() });
  } catch {
    // Persistence failure degrades to in-memory-only for this page load —
    // never fatal, since inMemoryKey above already has it.
  }
}

/**
 * @returns {Promise<void>}
 */
export async function clearCachedBackupKey() {
  inMemoryKey = null;
  try {
    await db.cryptoKeys.delete(ROW_ID);
  } catch {
    // Best-effort — if this fails, a stale row just sits unused in IndexedDB.
  }
}
