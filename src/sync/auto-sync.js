import Dexie from "../vendor/dexie.mjs";
import { backupNow, BackupLockedError } from "./backup.js";
import { isSignedIn } from "./session.js";

const DEBOUNCE_MS = 4000;

/** @typedef {"idle" | "pending" | "syncing" | "synced" | "error" | "locked"} SyncStatus */

/** @type {SyncStatus} */
let status = "idle";
/** @type {Date | null} */
let lastSyncedAt = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let debounceTimer = null;
let listening = false;

/** @type {Set<() => void>} */
const statusListeners = new Set();

/**
 * @param {SyncStatus} next
 */
function setStatus(next) {
  status = next;
  for (const listener of statusListeners) listener();
}

/**
 * Notifies the given listener on every status or lastSyncedAt change, so a
 * rendered view can keep its "Syncing…"/"Synced at…" text current instead of
 * only refreshing on next render.
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeToSyncStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function onStorageMutated() {
  if (!isSignedIn()) return;
  setStatus("pending");
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(syncNow, DEBOUNCE_MS);
}

/**
 * Pushes a backup right now and updates the shared status — used both by
 * the debounced auto-trigger and the manual "Back up now" button, so
 * `getSyncStatus()` reflects whichever one last ran.
 */
export async function syncNow() {
  setStatus("syncing");
  try {
    await backupNow();
    lastSyncedAt = new Date();
    setStatus("synced");
  } catch (err) {
    // Deliberately no retry timer here — the next local edit or app
    // foreground is what re-attempts, per the plan's failure-handling design.
    if (err instanceof BackupLockedError) {
      setStatus("locked");
      throw err;
    }
    setStatus("error");
    throw new Error("Backup failed.");
  }
}

/**
 * Starts listening for local writes (any table, via Dexie's global
 * `storagemutated` event) and pushes a debounced backup on each one. Also
 * pushes immediately on start, so signing in backs up right away rather than
 * waiting for the next edit.
 */
export function startAutoSync() {
  if (!listening) {
    Dexie.on("storagemutated", onStorageMutated);
    listening = true;
  }
  syncNow();
}

export function stopAutoSync() {
  if (listening) {
    Dexie.on("storagemutated").unsubscribe(onStorageMutated);
    listening = false;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  status = "idle";
}

export function getSyncStatus() {
  return { status, lastSyncedAt };
}

/**
 * Unsticks a stale "locked" status once something other than a push has
 * proven the cached key actually works — called by restoreFromCloud() right
 * after a successful decrypt, so pulling a backup down can clear the
 * "Unlock cloud backup" button without waiting for the next push to succeed.
 * A no-op if status isn't "locked", so it's safe to call unconditionally.
 */
export function clearLockedStatus() {
  if (status === "locked") setStatus("idle");
}
