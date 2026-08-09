import { exportAllData, importAllData } from "../db/db.js";
import { pushBackup, pullBackup } from "../api/client.js";
import { getCachedBackupKey } from "./backup-key-cache.js";
import {
  encryptBackupPayload,
  decryptBackupPayload,
  isEncryptedEnvelope,
  BackupDecryptError,
} from "./backup-crypto.js";

export { BackupDecryptError };

export class BackupLockedError extends Error {}

/** @type {"unknown" | "none" | "plaintext" | "encrypted"} */
let cachedFormat = "unknown";

/**
 * Invalidated on sign-out/delete-account (via session.js's
 * clearSessionState()) so a different account signing in within the same
 * tab, without a reload, doesn't reuse a stale fact about the previous one.
 */
export function resetRemoteBackupFormatCache() {
  cachedFormat = "unknown";
}

/**
 * @returns {Promise<"none" | "plaintext" | "encrypted">}
 */
async function getRemoteBackupFormat() {
  if (cachedFormat !== "unknown") return cachedFormat;
  try {
    const data = await pullBackup();
    cachedFormat = isEncryptedEnvelope(data) ? "encrypted" : "plaintext";
  } catch (err) {
    if (err instanceof Error && /** @type {any} */ (err).status === 404) {
      cachedFormat = "none";
    } else {
      throw err; // don't cache a guess on a real failure (network, 401, ...)
    }
  }
  return cachedFormat;
}

export async function backupNow() {
  const format = await getRemoteBackupFormat();
  const key = await getCachedBackupKey();

  if (format === "encrypted" && !key) {
    throw new BackupLockedError("Cloud backup is locked on this device.");
  }

  const data = await exportAllData();
  if (key) {
    const result = await pushBackup(await encryptBackupPayload(key, data));
    cachedFormat = "encrypted";
    return result;
  }
  const result = await pushBackup(data);
  cachedFormat = "plaintext";
  return result;
}

export async function restoreFromCloud() {
  const data = await pullBackup();
  if (isEncryptedEnvelope(data)) {
    cachedFormat = "encrypted";
    const key = await getCachedBackupKey();
    if (!key) throw new BackupDecryptError("No local key available to unlock this backup.");
    return importAllData(await decryptBackupPayload(key, data));
  }
  cachedFormat = "plaintext";
  return importAllData(data);
}
