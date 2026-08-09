const ALLOWED_ORIGIN = "https://coffee.blut.dev";
const SESSION_COOKIE_NAME = "session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
// Sliding-expiration window: an authenticated request within this long of
// the session's expiry mints a fresh 30-day expiry instead, so an actively
// used app never hits the wall. Chosen loosely enough that a session isn't
// re-extended on literally every request once it's within range.
const SESSION_RENEWAL_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

/**
 * @param {unknown} body
 * @param {ResponseInit} [init]
 */
export function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...(init.headers ?? {}),
    },
  });
}

/**
 * @param {string} text
 * @returns {Promise<string>} hex-encoded SHA-256 digest
 */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A random, URL-safe session token (32 bytes of entropy).
 * @returns {string}
 */
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * @param {Request} request
 * @returns {string | undefined}
 */
export function getSessionToken(request) {
  const header = request.headers.get("Cookie") ?? "";
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * @param {string} token
 * @param {number} maxAgeSeconds
 */
export function sessionCookieHeader(token, maxAgeSeconds) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * @typedef {Object} SessionQueryable narrower than the full D1Database
 *   interface — just the one query shape this function needs, so a plain
 *   test double can satisfy it without stubbing batch/exec/etc. too.
 * @property {(sql: string) => {
 *   bind: (tokenHash: string) => { first: () => Promise<{ user_id: string, expires_at: string } | null> }
 * }} prepare
 */

/**
 * @typedef {Object} Session
 * @property {string} userId
 * @property {string} token raw cookie value, needed to re-issue Set-Cookie on renewal
 * @property {string} tokenHash
 * @property {number} expiresAt epoch ms
 */

/**
 * Looks up the session row for this request's cookie, or null if there
 * isn't a valid, unexpired session.
 * @param {Request} request
 * @param {{ caffe_backups: SessionQueryable }} env
 * @returns {Promise<Session | null>}
 */
async function resolveSession(request, env) {
  const token = getSessionToken(request);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.caffe_backups
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first();
  if (!row) return null;

  const expiresAt = new Date(/** @type {string} */ (row.expires_at)).getTime();
  if (expiresAt < Date.now()) return null;

  return { userId: /** @type {string} */ (row.user_id), token, tokenHash, expiresAt };
}

/**
 * Resolves the signed-in user's id from the session cookie, or null if
 * there isn't a valid, unexpired session.
 * @param {Request} request
 * @param {{ caffe_backups: SessionQueryable }} env
 * @returns {Promise<string | null>}
 */
export async function getSessionUserId(request, env) {
  const session = await resolveSession(request, env);
  return session?.userId ?? null;
}

/**
 * Resolves the signed-in user, sliding the session's expiry forward (and
 * returning a fresh Set-Cookie header) when it's within the renewal
 * window. Returns null if there's no valid session.
 * @param {Request} request
 * @param {{ caffe_backups: D1Database }} env
 * @returns {Promise<{ userId: string, renewedCookie: string | null } | null>}
 */
export async function resolveAndRenewSession(request, env) {
  const session = await resolveSession(request, env);
  if (!session) return null;

  if (session.expiresAt - Date.now() > SESSION_RENEWAL_THRESHOLD_MS) {
    return { userId: session.userId, renewedCookie: null };
  }

  const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.caffe_backups
    .prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
    .bind(newExpiresAt, session.tokenHash)
    .run();

  return {
    userId: session.userId,
    renewedCookie: sessionCookieHeader(session.token, SESSION_TTL_SECONDS),
  };
}

/**
 * Attaches a Set-Cookie header for a freshly minted session to a JSON response.
 * @param {unknown} body
 * @param {string} token
 */
export function jsonWithSession(body, token) {
  const response = json(body);
  response.headers.append("Set-Cookie", sessionCookieHeader(token, SESSION_TTL_SECONDS));
  return response;
}

export function isoNow() {
  return new Date().toISOString();
}
