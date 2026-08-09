import { getPrfSalt } from "../api/client.js";

// The vendored client (src/vendor/passwordless-client.mjs) is plain,
// unannotated JS — under checkJs, TS infers members only ever called from
// within the class itself (registerBegin, registerComplete, signinBegin,
// signinComplete, config) as private, since this module calls them from
// outside. `client` is typed `any` throughout rather than fighting that
// inference; the vendored file is intentionally left unmodified.

const SALT_STORAGE_KEY = "backup-prf-salt";

/** @type {Promise<Uint8Array> | null} */
let saltPromise = null;

/**
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {string} base64Url
 * @returns {Uint8Array}
 */
function base64UrlToArrayBuffer(base64Url) {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64.padEnd(base64.length + paddingNeeded, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * localStorage first (persists indefinitely — correct given the salt must
 * never change once minted), network only on a true cache miss. This is
 * what keeps the local-only "unlock" ceremony below actually usable offline
 * after its first-ever fetch (which always happens during registration or a
 * first sign-in, both already network-bound anyway).
 * @returns {Promise<Uint8Array>}
 */
function loadSalt() {
  saltPromise ??= (async () => {
    const cached = localStorage.getItem(SALT_STORAGE_KEY);
    if (cached) return base64ToUint8Array(cached);
    const { salt } = await getPrfSalt();
    localStorage.setItem(SALT_STORAGE_KEY, salt);
    return base64ToUint8Array(salt);
  })();
  return saltPromise;
}

/**
 * The shared local get() ceremony behind both probePrfLocally and
 * unlockBackupKeyLocally — never talks to any server, discards the
 * assertion itself, only reads clientExtensionResults.
 * @param {any} client
 * @param {{ allowCredentials?: PublicKeyCredentialDescriptor[] }} [options]
 * @returns {Promise<ArrayBuffer | null>}
 */
async function evalPrfLocally(client, { allowCredentials } = {}) {
  const salt = await loadSalt();
  const credential = /** @type {PublicKeyCredential | null} */ (
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: client.config.rpid,
        allowCredentials,
        userVerification: "preferred",
        extensions: /** @type {any} */ ({ prf: { eval: { first: salt } } }),
      },
    })
  );
  return (
    /** @type {any} */ (credential?.getClientExtensionResults()).prf?.results?.first ?? null
  );
}

/**
 * Non-fatal capability probe — swallows ALL errors (including user
 * cancellation) to null, since callers use this as a check that must never
 * fail the caller's flow.
 * @param {any} client
 * @param {{ allowCredentials?: PublicKeyCredentialDescriptor[] }} [options]
 * @returns {Promise<ArrayBuffer | null>}
 */
async function probePrfLocally(client, options) {
  try {
    return await evalPrfLocally(client, options);
  } catch {
    return null;
  }
}

/**
 * Registers a new credential with PRF requested, mirroring
 * PasswordlessClient.register()'s body/error shape exactly, but injecting
 * the prf extension and returning the derived secret alongside. Does not
 * modify the vendored client — calls its public low-level registerBegin/
 * registerComplete directly instead of the register() wrapper, which has no
 * extension hook.
 * @param {any} client
 * @param {string} registerToken
 * @param {string} [nickname]
 * @returns {Promise<{ error?: { title?: string, [key: string]: unknown }, prfSecret?: ArrayBuffer | null }>}
 */
export async function registerWithPrf(client, registerToken, nickname) {
  try {
    const registration = await client.registerBegin(registerToken);
    if (registration.error) return { error: registration.error };

    // registerBegin() (unlike signinBegin()) returns these as raw base64url
    // strings — the vendored register() wrapper converts them itself right
    // after calling registerBegin(), so bypassing that wrapper means we have
    // to replicate the conversion here.
    registration.data.challenge = base64UrlToArrayBuffer(registration.data.challenge);
    registration.data.user.id = base64UrlToArrayBuffer(registration.data.user.id);
    for (const excluded of registration.data.excludeCredentials ?? []) {
      excluded.id = base64UrlToArrayBuffer(excluded.id);
    }
    registration.data.extensions = /** @type {any} */ ({
      ...registration.data.extensions,
      prf: { eval: { first: await loadSalt() } },
    });

    const credential = /** @type {PublicKeyCredential | null} */ (
      await navigator.credentials.create({ publicKey: registration.data })
    );
    if (!credential) {
      return {
        error: {
          from: "client",
          errorCode: "failed_create_credential",
          title: "Failed to create credential (navigator.credentials.create returned null)",
        },
      };
    }

    const ext = /** @type {any} */ (credential.getClientExtensionResults());
    let prfSecret = ext.prf?.results?.first ?? null;
    if (prfSecret == null && ext.prf?.enabled) {
      // create()'s eager eval isn't honored by every authenticator even
      // when prf.enabled comes back true — one follow-up local get(),
      // scoped to the credential we just created, to actually obtain it.
      prfSecret = await probePrfLocally(client, {
        allowCredentials: [{ id: credential.rawId, type: "public-key" }],
      });
    }

    const result = await client.registerComplete(credential, registration.session, nickname);
    if (result.error) return { error: result.error };

    return { prfSecret };
  } catch (err) {
    return {
      error: {
        from: "client",
        errorCode: "unknown",
        title: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Signs in with the given signinMethod, mirroring PasswordlessClient.signin()'s
 * body/error/token shape, injecting prf.eval into the single get() call — no
 * extra prompt needed here, unlike registration, since get() with prf.eval is
 * broadly honored whenever the credential supports PRF at all.
 * @param {any} client
 * @param {Record<string, unknown>} signinMethod
 * @returns {Promise<{ error?: { title?: string, [key: string]: unknown }, token?: string, prfSecret?: ArrayBuffer | null }>}
 */
export async function signinWithPrf(client, signinMethod) {
  try {
    const signin = await client.signinBegin(signinMethod);
    if (signin.error) return { error: signin.error };

    signin.data.extensions = /** @type {any} */ ({
      ...signin.data.extensions,
      prf: { eval: { first: await loadSalt() } },
    });

    const credential = /** @type {PublicKeyCredential | null} */ (
      await navigator.credentials.get({ publicKey: signin.data })
    );
    if (!credential) {
      return { error: { from: "client", errorCode: "unknown", title: "Sign-in was cancelled." } };
    }

    const prfSecret =
      /** @type {any} */ (credential.getClientExtensionResults()).prf?.results?.first ?? null;

    const result = await client.signinComplete(credential, signin.session);
    if (result.error) return { error: result.error };

    return { token: result.token, prfSecret };
  } catch (err) {
    return {
      error: {
        from: "client",
        errorCode: "unknown",
        title: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Used only by the explicit "Unlock cloud backup" action — unlike
 * probePrfLocally, this rethrows on failure/cancellation so the caller can
 * show a real error, since here the user explicitly asked to unlock.
 * @param {any} client
 * @returns {Promise<ArrayBuffer>}
 */
export async function unlockBackupKeyLocally(client) {
  let prfSecret;
  try {
    prfSecret = await evalPrfLocally(client);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Couldn't unlock — try again.");
  }
  if (!prfSecret) {
    throw new Error("Couldn't unlock cloud backup on this device.");
  }
  return prfSecret;
}
