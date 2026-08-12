import Dexie from "../vendor/dexie.mjs";
import {
  backupNow,
  restoreFromCloud,
  markDirty,
  isDirty,
  getKnownRevision,
  BackupLockedError,
  BackupConflictError,
} from "./backup.js";
import { getBackupRevision } from "../api/client.js";
import { isSignedIn } from "./session.js";
import { hasNoLocalData } from "../db/db.js";

const DEBOUNCE_MS = 4000;
// Rapid app-switching shouldn't spam the cloud with a rev check on every
// single foreground resume.
const RECONCILE_COOLDOWN_MS = 30_000;

/** @typedef {"idle" | "pending" | "syncing" | "synced" | "error" | "locked" | "conflict"} SyncStatus */

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
  // Persisted immediately (not just the in-memory "pending" status below) so
  // a device that edits data and closes before the debounced push below
  // completes still remembers "I have unconfirmed changes" on its next
  // boot — see reconcileWithCloud, which must not pull over this.
  markDirty();
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
    if (err instanceof BackupConflictError) {
      // Doesn't self-heal (see BackupConflictError's own doc comment) — a
      // subsequent edit's auto-push will just hit the same conflict again
      // until the user explicitly resolves it via the Settings card.
      setStatus("conflict");
      throw err;
    }
    setStatus("error");
    throw new Error("Backup failed.");
  }
}

let lastReconcileAt = 0;

/**
 * Silent, automatic catch-up: if this device has no unconfirmed local
 * changes, checks the cloud's revision and pulls if it's ahead — covers a
 * device that's simply stale (another device pushed while it wasn't
 * looking) with zero user interaction. Deliberately does nothing if the
 * device has local changes pending, or has never yet completed a sync of
 * its own while still holding real local data (the moment right after
 * linking a device that already had data — cloud-setup.js's sign-in flow
 * owns that specific push-vs-pull decision already; racing it here could
 * clobber real local data with an unrelated cloud backup).
 */
export async function reconcileWithCloud() {
  if (!isSignedIn()) return;
  if (isDirty()) return;

  const now = Date.now();
  if (now - lastReconcileAt < RECONCILE_COOLDOWN_MS) return;
  lastReconcileAt = now;

  try {
    if (getKnownRevision() === 0 && !(await hasNoLocalData())) return;
    const { rev } = await getBackupRevision();
    if (rev !== getKnownRevision()) {
      await restoreFromCloud();
    }
  } catch {
    // Best-effort background check — a network hiccup or no-backup-yet 404
    // here shouldn't be surfaced; the normal push path still works fine.
  }
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") reconcileWithCloud();
}

/**
 * Starts listening for local writes (any table, via Dexie's global
 * `storagemutated` event) and pushes a debounced backup on each one. Also
 * pushes immediately on start, so signing in backs up right away rather than
 * waiting for the next edit. Also starts reconciling with the cloud on every
 * foreground resume (see reconcileWithCloud) — boot itself is handled
 * separately by main.js, since a service-worker-less PWA can go a long time
 * between reloads while switching foreground/background many times.
 */
export function startAutoSync() {
  if (!listening) {
    Dexie.on("storagemutated", onStorageMutated);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    listening = true;
  }
  syncNow();
}

export function stopAutoSync() {
  if (listening) {
    Dexie.on("storagemutated").unsubscribe(onStorageMutated);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    listening = false;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  status = "idle";
  lastReconcileAt = 0;
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

/**
 * Unsticks a stale "conflict" status once the user has resolved it by
 * explicitly taking the cloud's version — called by restoreFromCloud(),
 * which (like the key-proving case above) doesn't go through syncNow()'s
 * own status transitions. A no-op if status isn't "conflict".
 */
export function clearConflictStatus() {
  if (status === "conflict") setStatus("idle");
}
