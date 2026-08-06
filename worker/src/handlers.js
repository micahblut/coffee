import {
  json,
  jsonWithSession,
  sha256Hex,
  randomToken,
  getSessionToken,
  getSessionUserId,
  clearSessionCookieHeader,
  isoNow,
  corsHeaders,
  SESSION_TTL_SECONDS,
} from "./lib.js";
import { verifyTurnstile } from "./turnstile.js";
import { createRegisterToken, verifySigninToken, listCredentials } from "./passwordless.js";

const MAX_BACKUP_BYTES = 1.5 * 1024 * 1024;

/**
 * @param {{ caffe_backups: D1Database, INVITE_CODE_SALT: string }} env
 * @param {string} code
 */
async function findValidInviteCode(env, code) {
  const hash = await sha256Hex(code + env.INVITE_CODE_SALT);
  const row = await env.caffe_backups
    .prepare(
      "SELECT id, max_uses, use_count, revoked_at, expires_at FROM invite_codes WHERE code_hash = ?",
    )
    .bind(hash)
    .first();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(/** @type {string} */ (row.expires_at)).getTime() < Date.now()) {
    return null;
  }
  if (/** @type {number} */ (row.use_count) >= /** @type {number} */ (row.max_uses)) return null;
  return row;
}

/**
 * @param {{ caffe_backups: D1Database }} env
 * @param {string} userId
 */
async function mintSession(env, userId) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.caffe_backups
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(
      tokenHash,
      userId,
      new Date(now).toISOString(),
      new Date(now + SESSION_TTL_SECONDS * 1000).toISOString(),
    )
    .run();
  return token;
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleRegisterBegin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.inviteCode || !body?.turnstileToken) {
    return json({ error: "inviteCode and turnstileToken are required" }, { status: 400 });
  }

  const turnstileOk = await verifyTurnstile(
    body.turnstileToken,
    env.TURNSTILE_SECRET_KEY,
    request.headers.get("CF-Connecting-IP"),
  );
  if (!turnstileOk) return json({ error: "Turnstile verification failed" }, { status: 400 });

  const invite = await findValidInviteCode(env, body.inviteCode);
  if (!invite) return json({ error: "Invalid or expired invite code" }, { status: 400 });

  const userId = crypto.randomUUID();
  const registerToken = await createRegisterToken(env.PASSWORDLESS_API_SECRET, {
    userId,
    username: userId,
  });

  return json({ userId, inviteCodeId: invite.id, registerToken });
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleRegisterComplete(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.userId || !body?.inviteCodeId) {
    return json({ error: "userId and inviteCodeId are required" }, { status: 400 });
  }

  const credentials = await listCredentials(env.PASSWORDLESS_API_SECRET, body.userId);
  if (!credentials.length) {
    return json({ error: "No passkey registered for this userId yet" }, { status: 400 });
  }

  const now = isoNow();
  await env.caffe_backups.batch([
    env.caffe_backups
      .prepare("INSERT INTO users (id, invite_code_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)")
      .bind(body.userId, body.inviteCodeId, now, now),
    env.caffe_backups
      .prepare("UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ?")
      .bind(body.inviteCodeId),
  ]);

  const token = await mintSession(env, body.userId);
  return jsonWithSession({ ok: true }, token);
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleLoginComplete(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.signinToken) return json({ error: "signinToken is required" }, { status: 400 });

  const verified = await verifySigninToken(env.PASSWORDLESS_API_SECRET, body.signinToken);
  if (!verified) return json({ error: "Sign-in verification failed" }, { status: 401 });

  const user = await env.caffe_backups
    .prepare("SELECT id FROM users WHERE id = ?")
    .bind(verified.userId)
    .first();
  if (!user) return json({ error: "Unknown account" }, { status: 401 });

  await env.caffe_backups
    .prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
    .bind(isoNow(), user.id)
    .run();

  const token = await mintSession(env, /** @type {string} */ (user.id));
  return jsonWithSession({ ok: true }, token);
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleSession(request, env) {
  const userId = await getSessionUserId(request, env);
  if (!userId) return json({ error: "Not signed in" }, { status: 401 });
  return json({ userId });
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleBackupPost(request, env) {
  const userId = await getSessionUserId(request, env);
  if (!userId) return json({ error: "Not signed in" }, { status: 401 });

  const text = await request.text();
  if (text.length > MAX_BACKUP_BYTES) {
    return json({ error: "Backup too large" }, { status: 413 });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null) {
    return json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const now = isoNow();
  await env.caffe_backups.batch([
    env.caffe_backups.prepare("DELETE FROM backups WHERE user_id = ?").bind(userId),
    env.caffe_backups
      .prepare(
        "INSERT INTO backups (id, user_id, created_at, size_bytes, payload) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), userId, now, text.length, text),
  ]);

  return json({ createdAt: now });
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleBackupGet(request, env) {
  const userId = await getSessionUserId(request, env);
  if (!userId) return json({ error: "Not signed in" }, { status: 401 });

  const row = await env.caffe_backups
    .prepare("SELECT payload FROM backups WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(userId)
    .first();
  if (!row) return json({ error: "No backup found" }, { status: 404 });

  return new Response(/** @type {string} */ (row.payload), {
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleLogout(request, env) {
  const token = getSessionToken(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.caffe_backups.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }

  const response = json({ ok: true });
  response.headers.append("Set-Cookie", clearSessionCookieHeader());
  return response;
}
