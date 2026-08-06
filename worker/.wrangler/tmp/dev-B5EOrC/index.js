var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/lib.js
var ALLOWED_ORIGIN = "https://coffee.blut.dev";
var SESSION_COOKIE_NAME = "session";
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var SESSION_TTL_SECONDS = SESSION_TTL_MS / 1e3;
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(corsHeaders, "corsHeaders");
function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...init.headers ?? {}
    }
  });
}
__name(json, "json");
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(randomToken, "randomToken");
function getSessionToken(request) {
  const header = request.headers.get("Cookie") ?? "";
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return void 0;
}
__name(getSessionToken, "getSessionToken");
function sessionCookieHeader(token, maxAgeSeconds) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
__name(sessionCookieHeader, "sessionCookieHeader");
function clearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
__name(clearSessionCookieHeader, "clearSessionCookieHeader");
async function getSessionUserId(request, env) {
  const token = getSessionToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.caffe_backups.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").bind(tokenHash).first();
  if (!row) return null;
  if (new Date(
    /** @type {string} */
    row.expires_at
  ).getTime() < Date.now()) return null;
  return (
    /** @type {string} */
    row.user_id
  );
}
__name(getSessionUserId, "getSessionUserId");
function jsonWithSession(body, token) {
  const response = json(body);
  response.headers.append("Set-Cookie", sessionCookieHeader(token, SESSION_TTL_SECONDS));
  return response;
}
__name(jsonWithSession, "jsonWithSession");
function isoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(isoNow, "isoNow");

// src/turnstile.js
var SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
async function verifyTurnstile(token, secretKey, remoteIp) {
  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.success === true;
}
__name(verifyTurnstile, "verifyTurnstile");

// src/passwordless.js
var API_URL = "https://v4.passwordless.dev";
async function createRegisterToken(apiSecret, { userId, username }) {
  const response = await fetch(`${API_URL}/register/token`, {
    method: "POST",
    headers: { ApiSecret: apiSecret, "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      username,
      discoverable: true,
      userVerification: "preferred"
    })
  });
  if (!response.ok) {
    throw new Error(`Passwordless register/token failed: ${response.status}`);
  }
  const data = await response.json();
  return data.token;
}
__name(createRegisterToken, "createRegisterToken");
async function verifySigninToken(apiSecret, token) {
  const response = await fetch(`${API_URL}/signin/verify`, {
    method: "POST",
    headers: { ApiSecret: apiSecret, "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.success ? data : null;
}
__name(verifySigninToken, "verifySigninToken");
async function listCredentials(apiSecret, userId) {
  const response = await fetch(
    `${API_URL}/credentials/list?userId=${encodeURIComponent(userId)}`,
    { headers: { ApiSecret: apiSecret } }
  );
  if (!response.ok) return [];
  return response.json();
}
__name(listCredentials, "listCredentials");

// src/handlers.js
var MAX_BACKUP_BYTES = 1.5 * 1024 * 1024;
async function findValidInviteCode(env, code) {
  const hash = await sha256Hex(code + env.INVITE_CODE_SALT);
  const row = await env.caffe_backups.prepare(
    "SELECT id, max_uses, use_count, revoked_at, expires_at FROM invite_codes WHERE code_hash = ?"
  ).bind(hash).first();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(
    /** @type {string} */
    row.expires_at
  ).getTime() < Date.now()) {
    return null;
  }
  if (
    /** @type {number} */
    row.use_count >= /** @type {number} */
    row.max_uses
  ) return null;
  return row;
}
__name(findValidInviteCode, "findValidInviteCode");
async function mintSession(env, userId) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.caffe_backups.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(
    tokenHash,
    userId,
    new Date(now).toISOString(),
    new Date(now + SESSION_TTL_SECONDS * 1e3).toISOString()
  ).run();
  return token;
}
__name(mintSession, "mintSession");
async function handleRegisterBegin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.inviteCode || !body?.turnstileToken) {
    return json({ error: "inviteCode and turnstileToken are required" }, { status: 400 });
  }
  const turnstileOk = await verifyTurnstile(
    body.turnstileToken,
    env.TURNSTILE_SECRET_KEY,
    request.headers.get("CF-Connecting-IP")
  );
  if (!turnstileOk) return json({ error: "Turnstile verification failed" }, { status: 400 });
  const invite = await findValidInviteCode(env, body.inviteCode);
  if (!invite) return json({ error: "Invalid or expired invite code" }, { status: 400 });
  const userId = crypto.randomUUID();
  const registerToken = await createRegisterToken(env.PASSWORDLESS_API_SECRET, {
    userId,
    username: userId
  });
  return json({ userId, inviteCodeId: invite.id, registerToken });
}
__name(handleRegisterBegin, "handleRegisterBegin");
async function handleRegisterComplete(request, env) {
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
    env.caffe_backups.prepare("INSERT INTO users (id, invite_code_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)").bind(body.userId, body.inviteCodeId, now, now),
    env.caffe_backups.prepare("UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ?").bind(body.inviteCodeId)
  ]);
  const token = await mintSession(env, body.userId);
  return jsonWithSession({ ok: true }, token);
}
__name(handleRegisterComplete, "handleRegisterComplete");
async function handleLoginComplete(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.signinToken) return json({ error: "signinToken is required" }, { status: 400 });
  const verified = await verifySigninToken(env.PASSWORDLESS_API_SECRET, body.signinToken);
  if (!verified) return json({ error: "Sign-in verification failed" }, { status: 401 });
  const user = await env.caffe_backups.prepare("SELECT id FROM users WHERE id = ?").bind(verified.userId).first();
  if (!user) return json({ error: "Unknown account" }, { status: 401 });
  await env.caffe_backups.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(isoNow(), user.id).run();
  const token = await mintSession(
    env,
    /** @type {string} */
    user.id
  );
  return jsonWithSession({ ok: true }, token);
}
__name(handleLoginComplete, "handleLoginComplete");
async function handleSession(request, env) {
  const userId = await getSessionUserId(request, env);
  if (!userId) return json({ error: "Not signed in" }, { status: 401 });
  return json({ userId });
}
__name(handleSession, "handleSession");
async function handleBackupPost(request, env) {
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
    env.caffe_backups.prepare(
      "INSERT INTO backups (id, user_id, created_at, size_bytes, payload) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), userId, now, text.length, text)
  ]);
  return json({ createdAt: now });
}
__name(handleBackupPost, "handleBackupPost");
async function handleBackupGet(request, env) {
  const userId = await getSessionUserId(request, env);
  if (!userId) return json({ error: "Not signed in" }, { status: 401 });
  const row = await env.caffe_backups.prepare("SELECT payload FROM backups WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(userId).first();
  if (!row) return json({ error: "No backup found" }, { status: 404 });
  return new Response(
    /** @type {string} */
    row.payload,
    {
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    }
  );
}
__name(handleBackupGet, "handleBackupGet");
async function handleLogout(request, env) {
  const token = getSessionToken(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.caffe_backups.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  const response = json({ ok: true });
  response.headers.append("Set-Cookie", clearSessionCookieHeader());
  return response;
}
__name(handleLogout, "handleLogout");

// src/index.js
var src_default = {
  /**
   * @param {Request} request
   * @param {any} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (url.pathname === "/healthz") {
      const row = await env.caffe_backups.prepare("SELECT 1 AS ok").first();
      return new Response(JSON.stringify({ ok: row?.ok === 1 }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
    if (url.pathname === "/register/begin" && request.method === "POST") {
      return handleRegisterBegin(request, env);
    }
    if (url.pathname === "/register/complete" && request.method === "POST") {
      return handleRegisterComplete(request, env);
    }
    if (url.pathname === "/login/complete" && request.method === "POST") {
      return handleLoginComplete(request, env);
    }
    if (url.pathname === "/session" && request.method === "GET") {
      return handleSession(request, env);
    }
    if (url.pathname === "/backup" && request.method === "GET") {
      return handleBackupGet(request, env);
    }
    if (url.pathname === "/backup" && request.method === "POST") {
      return handleBackupPost(request, env);
    }
    if (url.pathname === "/logout" && request.method === "POST") {
      return handleLogout(request, env);
    }
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-5c2qMW/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-5c2qMW/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
