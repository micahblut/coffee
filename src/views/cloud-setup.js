import { Client as PasswordlessClient } from "../vendor/passwordless-client.mjs";
import { PASSWORDLESS_PUBLIC_KEY, TURNSTILE_SITE_KEY } from "../config.js";
import { registerBegin, registerComplete, loginComplete } from "../api/client.js";
import { refreshSessionState, markCloudLinked } from "../sync/session.js";
import { startAutoSync } from "../sync/auto-sync.js";
import { restoreFromCloud } from "../sync/backup.js";
import { hasNoLocalData } from "../db/db.js";

/**
 * Signs in on a device that already has a passkey registered for this app
 * but no local session (e.g. a fresh browser profile) — no invite code or
 * Turnstile involved, since this can't be brute-forced without already
 * possessing a real passkey. Must be called from a direct user gesture
 * (a click handler), since WebAuthn requires one.
 */
export async function signInWithPasskey() {
  const client = new PasswordlessClient({ apiKey: PASSWORDLESS_PUBLIC_KEY });
  const { token, error } = await client.signinWithDiscoverable();
  if (error) throw new Error(error.title || "Sign-in failed.");

  await loginComplete(/** @type {string} */ (token));
  markCloudLinked();
  await refreshSessionState();

  // This is almost always a fresh device with an existing cloud backup —
  // pull it down rather than letting auto-sync push this empty state up
  // and overwrite the real backup. A device that already has local data
  // keeps the normal push-based auto-sync, matching the "Back up data" /
  // "Restore from cloud" buttons' existing latest-wins model.
  if (await hasNoLocalData()) {
    await restoreFromCloud();
  }
  startAutoSync();
}

const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";
/** @type {Promise<any> | null} */
let turnstileScriptPromise = null;

/**
 * Loads Cloudflare's Turnstile widget script on demand — only when this
 * modal actually opens, never on the main app load path.
 * @returns {Promise<any>}
 */
function loadTurnstile() {
  if (turnstileScriptPromise) return turnstileScriptPromise;
  const win = /** @type {any} */ (window);
  turnstileScriptPromise = new Promise((resolve, reject) => {
    if (win.turnstile) {
      resolve(win.turnstile);
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", () => resolve(win.turnstile));
    script.addEventListener("error", () => reject(new Error("Failed to load Turnstile.")));
    document.head.append(script);
  });
  return turnstileScriptPromise;
}

/**
 * @param {HTMLElement} container
 * @param {import("../main.js").Nav} nav
 * @param {{ onRegistered: () => void }} options
 */
export async function renderCloudSetupModal(container, nav, { onRegistered }) {
  container.innerHTML = `
    <h2>Set up cloud backup</h2>
    <p>Enter your invite code, then register a passkey for this device.</p>
    <form id="cloud-setup-form">
      <div>
        <label for="invite-code-input">Invite code</label>
        <input id="invite-code-input" name="inviteCode" autocomplete="off" required />
      </div>
      <div id="turnstile-container"></div>
      <button type="submit" class="brew-button">Continue</button>
    </form>
    <p id="cloud-setup-status"></p>
  `;

  const status = /** @type {HTMLElement} */ (
    container.querySelector("#cloud-setup-status")
  );
  const form = /** @type {HTMLFormElement} */ (
    container.querySelector("#cloud-setup-form")
  );
  const turnstileContainer = /** @type {HTMLElement} */ (
    container.querySelector("#turnstile-container")
  );

  let turnstileToken = /** @type {string | null} */ (null);

  try {
    const turnstile = await loadTurnstile();
    const widgetId = turnstile.render(turnstileContainer, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: "interaction-only",
      size: "flexible",
      callback: (/** @type {string} */ token) => {
        turnstileToken = token;
      },
    });
    // The modal sheet gets torn out of the DOM (drag-dismiss or after
    // registering) without any close hook, so watch for that directly —
    // otherwise this widget is orphaned and Cloudflare's script keeps
    // trying to manage an iframe that's no longer there.
    const cleanupObserver = new MutationObserver(() => {
      if (container.isConnected) return;
      turnstile.remove(widgetId);
      cleanupObserver.disconnect();
    });
    cleanupObserver.observe(document.body, { childList: true, subtree: true });
  } catch {
    status.textContent =
      "Couldn't load the verification check. Check your connection and try again.";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!turnstileToken) {
      status.textContent = "Please complete the verification check.";
      return;
    }

    const inviteCode = String(new FormData(form).get("inviteCode") ?? "").trim();
    if (!inviteCode) return;

    status.textContent = "Registering...";
    try {
      const { userId, inviteCodeId, registerToken } = await registerBegin(
        inviteCode,
        turnstileToken,
      );

      const client = new PasswordlessClient({ apiKey: PASSWORDLESS_PUBLIC_KEY });
      const { error } = await client.register(registerToken);
      if (error) throw new Error(error.title || "Passkey registration failed.");

      await registerComplete(userId, inviteCodeId);
      markCloudLinked();
      await refreshSessionState();
      startAutoSync();
      onRegistered();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : "Something went wrong.";
    }
  });
}
