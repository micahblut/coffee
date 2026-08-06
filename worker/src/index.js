import { corsHeaders } from "./lib.js";
import {
  handleRegisterBegin,
  handleRegisterComplete,
  handleLoginComplete,
  handleSession,
  handleBackupGet,
  handleBackupPost,
  handleLogout,
} from "./handlers.js";

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/healthz") {
      const row = await env.caffe_backups.prepare("SELECT 1 AS ok").first();
      return new Response(JSON.stringify({ ok: row?.ok === 1 }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
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
  },
};
