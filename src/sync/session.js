import { checkSession } from "../api/client.js";
import { clearCachedBackupKey } from "./backup-key-cache.js";
import { resetRemoteBackupFormatCache } from "./backup.js";

// Persisted separately from currentUserId (which resets to unknown on every
// reload) so a device that has ever completed passkey registration/sign-in
// can be distinguished from one that never has — that's what lets the home
// screen's reauth callout target "your session expired" without ever
// showing up for someone who's simply never set up cloud backup.
const CLOUD_LINKED_KEY = "cloud-linked";
const REAUTH_DISMISSED_KEY = "cloud-reauth-dismissed";

let currentUserId = /** @type {string | null} */ (null);
// Distinguishes "haven't checked yet this load" from "checked, and signed
// out" — without it, the reauth callout would flash on every cold boot for
// a linked device while refreshSessionState's network round-trip is still
// in flight.
let sessionChecked = false;

/** @type {Set<() => void>} */
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Notifies the given listener whenever signed-in/dismissed state changes —
 * used by the home screen to reveal or hide its reauth callout without
 * requiring a full re-render.
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeToSessionState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Asks the Worker whether the session cookie is valid and caches the result
 * in memory. There's nothing else to check client-side — the session token
 * itself lives in an httpOnly cookie the page's JS can't read.
 * @returns {Promise<string | null>}
 */
export async function refreshSessionState() {
  currentUserId = await checkSession();
  sessionChecked = true;
  notify();
  return currentUserId;
}

export function isSignedIn() {
  return currentUserId != null;
}

export function getUserId() {
  return currentUserId;
}

export function clearSessionState() {
  currentUserId = null;
  localStorage.removeItem(CLOUD_LINKED_KEY);
  localStorage.removeItem(REAUTH_DISMISSED_KEY);
  clearCachedBackupKey(); // fire-and-forget, best-effort by design
  resetRemoteBackupFormatCache();
  notify();
}

/**
 * Marks this device as having a cloud backup link, so a later expired
 * session is recognized as "sign in again" rather than "never set up" —
 * call after registration or sign-in completes. Also clears any earlier
 * dismissal, so a fresh link starts with a clean slate for the next time
 * its session happens to expire.
 */
export function markCloudLinked() {
  localStorage.setItem(CLOUD_LINKED_KEY, "1");
  localStorage.removeItem(REAUTH_DISMISSED_KEY);
}

/**
 * True once this device's session has been confirmed expired/absent after
 * previously being linked, and the user hasn't dismissed the reauth
 * callout for this expiry — i.e. exactly the case the home screen should
 * prompt for, and no other.
 */
export function shouldPromptReauth() {
  return (
    sessionChecked &&
    !isSignedIn() &&
    localStorage.getItem(CLOUD_LINKED_KEY) === "1" &&
    localStorage.getItem(REAUTH_DISMISSED_KEY) !== "1"
  );
}

export function dismissReauthPrompt() {
  localStorage.setItem(REAUTH_DISMISSED_KEY, "1");
  notify();
}
