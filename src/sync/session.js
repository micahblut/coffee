import { checkSession } from "../api/client.js";

let currentUserId = /** @type {string | null} */ (null);

/**
 * Asks the Worker whether the session cookie is valid and caches the result
 * in memory. There's nothing else to check client-side — the session token
 * itself lives in an httpOnly cookie the page's JS can't read.
 * @returns {Promise<string | null>}
 */
export async function refreshSessionState() {
  currentUserId = await checkSession();
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
}
