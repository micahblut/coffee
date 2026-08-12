import {
  json,
  jsonWithSession,
  sha256Hex,
  randomToken,
  getSessionToken,
  getSessionUserId,
  resolveAndRenewSession,
  clearSessionCookieHeader,
  isoNow,
  corsHeaders,
  SESSION_TTL_SECONDS,
} from "./lib.js";
import { verifyTurnstile } from "./turnstile.js";
import {
  createRegisterToken,
  verifySigninToken,
  listCredentials,
  deleteAllCredentials,
} from "./passwordless.js";

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
 * @param {Env} env
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
 * @param {Env} env
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
 * @param {Env} env
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
 * Static, non-secret config — no D1 read, no auth. Safety comes from the
 * credential's private key material, not from this value being hidden.
 * @param {Request} _request
 * @param {Env} env
 */
export async function handleBackupPrfSalt(_request, env) {
  return json({ salt: env.BACKUP_PRF_SALT });
}

/**
 * @param {Request} request
 * @param {Env} env
 */
export async function handleSession(request, env) {
  const session = await resolveAndRenewSession(request, env);
  if (!session) return json({ error: "Not signed in" }, { status: 401 });

  const response = json({ userId: session.userId });
  if (session.renewedCookie) response.headers.append("Set-Cookie", session.renewedCookie);
  return response;
}

/**
 * Upload is an optimistic-concurrency write, not a blind overwrite: the
 * client must declare which revision its snapshot is based on
 * (`baseRevision`), and the conditional upsert below only applies the write
 * if that still matches the stored `rev`. This is what stops Device B from
 * silently clobbering Device A's push with a stale copy — a mismatch means
 * something else was pushed in between, so the client needs to pull and
 * decide how to proceed rather than have this just overwrite it.
 * @param {Request} request
 * @param {Env} env
 */
export async function handleBackupPost(request, env) {
  const session = await resolveAndRenewSession(request, env);
  if (!session) return json({ error: "Not signed in" }, { status: 401 });
  const { userId } = session;

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

  const baseRevision = parsed.baseRevision;
  if (!Number.isInteger(baseRevision) || baseRevision < 0) {
    return json({ error: "baseRevision must be a non-negative integer" }, { status: 400 });
  }
  if (parsed.backup === undefined) {
    return json({ error: "Missing backup field" }, { status: 400 });
  }

  const payloadText = JSON.stringify(parsed.backup);
  if (payloadText.length > MAX_BACKUP_BYTES) {
    return json({ error: "Backup too large" }, { status: 413 });
  }

  const now = isoNow();
  const row = await env.caffe_backups
    .prepare(
      `INSERT INTO backups (user_id, rev, created_at, size_bytes, payload)
       VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         rev = backups.rev + 1,
         created_at = excluded.created_at,
         size_bytes = excluded.size_bytes,
         payload = excluded.payload
       WHERE backups.rev = ?
       RETURNING rev`,
    )
    .bind(userId, now, payloadText.length, payloadText, baseRevision)
    .first();

  // A fresh account's very first push always succeeds (the plain INSERT
  // path above never consults the WHERE guard, and there's nothing to
  // overwrite yet). row is only ever null when a backup already existed
  // and its rev didn't match baseRevision — the client is stale and must
  // pull before it can safely overwrite.
  if (!row) return json({ error: "Backup is out of date" }, { status: 409 });

  const response = json({ rev: row.rev, createdAt: now });
  if (session.renewedCookie) response.headers.append("Set-Cookie", session.renewedCookie);
  return response;
}

/**
 * @param {Request} request
 * @param {Env} env
 */
export async function handleBackupGet(request, env) {
  const session = await resolveAndRenewSession(request, env);
  if (!session) return json({ error: "Not signed in" }, { status: 401 });
  const { userId } = session;

  const row = await env.caffe_backups
    .prepare("SELECT rev, created_at, payload FROM backups WHERE user_id = ?")
    .bind(userId)
    .first();
  if (!row) return json({ error: "No backup found" }, { status: 404 });

  // payload is already-valid JSON text (validated on POST) — splice it in
  // as a raw fragment rather than parse-then-restringify a blob that can be
  // up to MAX_BACKUP_BYTES.
  const body = `{"rev":${row.rev},"createdAt":${JSON.stringify(row.created_at)},"backup":${row.payload}}`;
  const response = new Response(body, {
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
  if (session.renewedCookie) response.headers.append("Set-Cookie", session.renewedCookie);
  return response;
}

/**
 * Cheap freshness check used by the client's boot/foreground reconciliation
 * — just the revision number, so it doesn't have to download (and, for an
 * encrypted backup, couldn't decrypt anyway) the full payload just to
 * compare a counter.
 * @param {Request} request
 * @param {Env} env
 */
export async function handleBackupRevGet(request, env) {
  const session = await resolveAndRenewSession(request, env);
  if (!session) return json({ error: "Not signed in" }, { status: 401 });
  const { userId } = session;

  const row = await env.caffe_backups
    .prepare("SELECT rev, created_at FROM backups WHERE user_id = ?")
    .bind(userId)
    .first();
  if (!row) return json({ error: "No backup found" }, { status: 404 });

  const response = json({ rev: row.rev, createdAt: row.created_at });
  if (session.renewedCookie) response.headers.append("Set-Cookie", session.renewedCookie);
  return response;
}

/**
 * Permanently and irreversibly erases the signed-in user's account — the
 * passwordless.dev credentials (so signing back in is impossible), then
 * their D1 rows (sessions, backups, and the user itself). Deletes the
 * passwordless.dev side first: if that fails partway, retrying is safe
 * (it re-fetches whatever credentials are still there), whereas the
 * reverse order could strand a signed-out user with a live passkey but
 * no way to reach this endpoint again.
 * @param {Request} request
 * @param {Env} env
 */
export async function handleAccountDelete(request, env) {
  const userId = await getSessionUserId(request, env);
  if (!userId) return json({ error: "Not signed in" }, { status: 401 });

  await deleteAllCredentials(env.PASSWORDLESS_API_SECRET, userId);

  await env.caffe_backups.batch([
    env.caffe_backups.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    env.caffe_backups.prepare("DELETE FROM backups WHERE user_id = ?").bind(userId),
    env.caffe_backups.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);

  const response = json({ ok: true });
  response.headers.append("Set-Cookie", clearSessionCookieHeader());
  return response;
}

/**
 * @param {Request} request
 * @param {Env} env
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
