const ALLOWED_ORIGIN = "https://coffee.blut.dev";
const SESSION_COOKIE_NAME = "session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

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
 * Resolves the signed-in user's id from the session cookie, or null if
 * there isn't a valid, unexpired session.
 * @param {Request} request
 * @param {{ caffe_backups: D1Database }} env
 * @returns {Promise<string | null>}
 */
export async function getSessionUserId(request, env) {
  const token = getSessionToken(request);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.caffe_backups
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first();
  if (!row) return null;
  if (new Date(/** @type {string} */ (row.expires_at)).getTime() < Date.now()) return null;

  return /** @type {string} */ (row.user_id);
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
