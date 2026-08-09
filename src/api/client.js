import { API_BASE_URL } from "../config.js";

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = /** @type {Error & { status: number }} */ (
      new Error(data?.error ?? `Request to ${path} failed (${response.status})`)
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * @param {string} inviteCode
 * @param {string} turnstileToken
 * @returns {Promise<{ userId: string, inviteCodeId: string, registerToken: string }>}
 */
export function registerBegin(inviteCode, turnstileToken) {
  return request("/register/begin", {
    method: "POST",
    body: JSON.stringify({ inviteCode, turnstileToken }),
  });
}

/**
 * @param {string} userId
 * @param {string} inviteCodeId
 */
export function registerComplete(userId, inviteCodeId) {
  return request("/register/complete", {
    method: "POST",
    body: JSON.stringify({ userId, inviteCodeId }),
  });
}

/**
 * @param {string} signinToken
 */
export function loginComplete(signinToken) {
  return request("/login/complete", {
    method: "POST",
    body: JSON.stringify({ signinToken }),
  });
}

/**
 * @returns {Promise<string | null>} the signed-in userId, or null if not signed in
 */
export async function checkSession() {
  try {
    const data = await request("/session");
    return data.userId;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} data
 */
export function pushBackup(data) {
  return request("/backup", { method: "POST", body: JSON.stringify(data) });
}

/**
 * @returns {Promise<unknown>}
 */
export function pullBackup() {
  return request("/backup");
}

/**
 * The PRF salt is non-secret, static, app-wide config held server-side (see
 * worker/src/env.d.ts) — a plain unauthenticated GET.
 * @returns {Promise<{ salt: string }>}
 */
export function getPrfSalt() {
  return request("/prf-salt");
}

export function logout() {
  return request("/logout", { method: "POST" });
}

/**
 * Permanently deletes the signed-in user's account: passwordless.dev
 * credentials, cloud backups, and the D1 user row.
 */
export function deleteAccount() {
  return request("/account/delete", { method: "POST" });
}
