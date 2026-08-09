import { Client as PasswordlessClient } from "../vendor/passwordless-client.mjs";
import { PASSWORDLESS_PUBLIC_KEY, TURNSTILE_SITE_KEY } from "../config.js";
import { registerBegin, registerComplete, loginComplete, logout } from "../api/client.js";
import { refreshSessionState, markCloudLinked, clearSessionState } from "../sync/session.js";
import { startAutoSync, syncNow } from "../sync/auto-sync.js";
import { restoreFromCloud, BackupDecryptError } from "../sync/backup.js";
import { hasNoLocalData } from "../db/db.js";
import { registerWithPrf, signinWithPrf, unlockBackupKeyLocally } from "../sync/webauthn-prf.js";
import { deriveKeyFromPrfSecret } from "../sync/backup-crypto.js";
import { cacheBackupKey } from "../sync/backup-key-cache.js";

/**
 * Signs in on a device that already has a passkey registered for this app
 * but no local session (e.g. a fresh browser profile) — no invite code or
 * Turnstile involved, since this can't be brute-forced without already
 * possessing a real passkey. Must be called from a direct user gesture
 * (a click handler), since WebAuthn requires one.
 */
export async function signInWithPasskey() {
  const client = new PasswordlessClient({ apiKey: PASSWORDLESS_PUBLIC_KEY });
  const { token, error, prfSecret } = await signinWithPrf(client, { discoverable: true });
  if (error) throw new Error(error.title || "Sign-in failed.");

  await loginComplete(/** @type {string} */ (token));
  markCloudLinked();
  await refreshSessionState();

  if (prfSecret) {
    try {
      await cacheBackupKey(await deriveKeyFromPrfSecret(prfSecret));
    } catch {
      // Not fatal — the "Unlock cloud backup" flow can retry later.
    }
  }

  // This is almost always a fresh device with an existing cloud backup —
  // pull it down rather than letting auto-sync push this empty state up
  // and overwrite the real backup. A device that already has local data
  // keeps the normal push-based auto-sync, matching the "Back up data" /
  // "Restore from cloud" buttons' existing latest-wins model.
  if (await hasNoLocalData()) {
    try {
      await restoreFromCloud();
    } catch (err) {
      if (err instanceof BackupDecryptError) {
        // The session cookie is already set server-side by loginComplete()
        // above — an unavoidable side effect of needing a valid session to
        // even GET /backup before decryption can be attempted. Roll it back
        // explicitly so this device never renders as signed in while unable
        // to read its own data.
        try {
          await logout();
        } catch {
          // Cookie may already be invalid — rolling back locally regardless.
        }
        clearSessionState();
        throw new Error("Couldn't unlock this backup on this device — sign-in cancelled.");
      }
      throw err; // non-decrypt failures: unchanged existing behavior
    }
  }
  startAutoSync();
}

/**
 * Re-derives and caches the PRF-based backup encryption key on a device
 * that's already signed in but has no usable key cached (e.g. cleared
 * storage, or a browser new to this credential) — purely local, since the
 * session is already valid and nothing here needs to touch it.
 */
export async function unlockCloudBackup() {
  const client = new PasswordlessClient({ apiKey: PASSWORDLESS_PUBLIC_KEY });
  const prfSecret = await unlockBackupKeyLocally(client); // throws on cancel/failure
  await cacheBackupKey(await deriveKeyFromPrfSecret(prfSecret));
  await syncNow(); // resumes syncing immediately, flips status off "locked"
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
      const { error, prfSecret } = await registerWithPrf(client, registerToken);
      if (error) throw new Error(error.title || "Passkey registration failed.");

      await registerComplete(userId, inviteCodeId);
      markCloudLinked();
      await refreshSessionState();

      if (prfSecret) {
        try {
          await cacheBackupKey(await deriveKeyFromPrfSecret(prfSecret));
        } catch {
          // Falls back to plaintext for this device's first push, same as
          // if the authenticator hadn't supported PRF at all.
        }
      }

      startAutoSync();
      onRegistered();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : "Something went wrong.";
    }
  });
}
