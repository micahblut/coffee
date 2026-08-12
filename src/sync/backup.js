import { exportAllData, importAllData } from "../db/db.js";
import { pushBackup, pullBackup, getBackupRevision } from "../api/client.js";
import { getCachedBackupKey } from "./backup-key-cache.js";
import { clearLockedStatus, clearConflictStatus } from "./auto-sync.js";
import {
  encryptBackupPayload,
  decryptBackupPayload,
  isEncryptedEnvelope,
  BackupDecryptError,
} from "./backup-crypto.js";

export { BackupDecryptError };

export class BackupLockedError extends Error {}

/**
 * Thrown when a push is rejected because another device changed the cloud
 * backup first (see worker/src/handlers.js's conditional-upsert on
 * baseRevision). Deliberately doesn't carry the server's real current
 * revision — absorbing it here would let the very next local edit's
 * auto-push succeed and silently overwrite the other device's changes a
 * few seconds later, recreating the exact bug this exists to prevent.
 * Resolving this requires an explicit action (see acknowledgeRemoteRevision).
 */
export class BackupConflictError extends Error {}

/** @type {"unknown" | "none" | "plaintext" | "encrypted"} */
let cachedFormat = "unknown";

const KNOWN_REVISION_KEY = "cloud-backup-revision";
const DIRTY_KEY = "cloud-backup-dirty";

/**
 * The last backup revision this device has confirmed the server is at
 * (from a successful push or pull) — 0 if it's never successfully synced.
 * @returns {number}
 */
export function getKnownRevision() {
  return Number(localStorage.getItem(KNOWN_REVISION_KEY) ?? 0);
}

/**
 * @param {number} rev
 */
function setKnownRevision(rev) {
  localStorage.setItem(KNOWN_REVISION_KEY, String(rev));
}

/**
 * Invalidated on sign-out/delete-account (via session.js's
 * clearSessionState()) so a different account signing in within the same
 * tab, without a reload, doesn't reuse a stale revision from the previous one.
 */
export function resetKnownRevision() {
  localStorage.removeItem(KNOWN_REVISION_KEY);
}

/**
 * Marks this device as having local changes not yet confirmed pushed —
 * persisted (not just in memory) so a device that edits data and closes
 * before its debounced push completes still correctly remembers "I have
 * unconfirmed changes" the next time it opens, rather than boot/foreground
 * reconciliation assuming it's safe to pull over them.
 */
export function markDirty() {
  localStorage.setItem(DIRTY_KEY, "1");
}

/**
 * Also used to reset this flag on sign-out/delete-account (via session.js's
 * clearSessionState()), so a different account signing in on the same
 * device doesn't inherit a "dirty" flag left over from the previous one.
 */
export function clearDirty() {
  localStorage.removeItem(DIRTY_KEY);
}

/**
 * @returns {boolean}
 */
export function isDirty() {
  return localStorage.getItem(DIRTY_KEY) === "1";
}

/**
 * Invalidated on sign-out/delete-account (via session.js's
 * clearSessionState()) so a different account signing in within the same
 * tab, without a reload, doesn't reuse a stale fact about the previous one.
 */
export function resetRemoteBackupFormatCache() {
  cachedFormat = "unknown";
}

/**
 * Best-effort snapshot of whether the last known backup (pushed or pulled)
 * was encrypted — "unknown" until a sync/restore has actually run this
 * session. Used to show a lock/key indicator in Settings without forcing an
 * extra network round-trip just to answer that question.
 * @returns {"unknown" | "none" | "plaintext" | "encrypted"}
 */
export function getCachedBackupFormat() {
  return cachedFormat;
}

/**
 * @returns {Promise<"none" | "plaintext" | "encrypted">}
 */
async function getRemoteBackupFormat() {
  if (cachedFormat !== "unknown") return cachedFormat;
  try {
    const { rev, backup } = await pullBackup();
    setKnownRevision(rev);
    cachedFormat = isEncryptedEnvelope(backup) ? "encrypted" : "plaintext";
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
  const backup = key ? await encryptBackupPayload(key, data) : data;

  let result;
  try {
    result = await pushBackup({ baseRevision: getKnownRevision(), backup });
  } catch (err) {
    if (err instanceof Error && /** @type {any} */ (err).status === 409) {
      throw new BackupConflictError("Cloud backup has changes from another device.");
    }
    throw err;
  }
  cachedFormat = key ? "encrypted" : "plaintext";
  setKnownRevision(result.rev);
  clearDirty();
  return result;
}

export async function restoreFromCloud() {
  const { rev, backup } = await pullBackup();
  if (isEncryptedEnvelope(backup)) {
    cachedFormat = "encrypted";
    const key = await getCachedBackupKey();
    if (!key) throw new BackupDecryptError("No local key available to unlock this backup.");
    const decrypted = await decryptBackupPayload(key, backup);
    // Reaching here proves the cached key actually decrypts the remote
    // backup, regardless of how it got cached — clear any stale "locked"
    // status left over from an earlier push that ran without a key. Local
    // data is about to actually be replaced with the cloud's, which also
    // resolves any prior conflict.
    clearLockedStatus();
    clearConflictStatus();
    setKnownRevision(rev);
    clearDirty();
    return importAllData(decrypted);
  }
  // Local data is about to be replaced with the cloud's, which resolves
  // any prior conflict.
  clearConflictStatus();
  cachedFormat = "plaintext";
  setKnownRevision(rev);
  clearDirty();
  return importAllData(backup);
}

/**
 * Learns the cloud's current revision without pulling/importing its data —
 * used after a conflict to let a deliberate retry (the user explicitly
 * clicking "Back up data" again) succeed as a "keep this device's version"
 * action, without discarding local data the way restoreFromCloud() would.
 */
export async function acknowledgeRemoteRevision() {
  const { rev } = await getBackupRevision();
  setKnownRevision(rev);
}
