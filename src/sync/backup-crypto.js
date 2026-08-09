const IV_BYTES = 12;
const AES_KEY_BYTES = 32;

export const ENCRYPTED_BACKUP_VERSION = 1;

export class BackupDecryptError extends Error {}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} base64Url
 * @returns {Uint8Array}
 */
function base64UrlDecode(base64Url) {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64.padEnd(base64.length + paddingNeeded, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {unknown} data
 * @returns {boolean}
 */
export function isEncryptedEnvelope(data) {
  const candidate = /** @type {{ encrypted?: unknown, iv?: unknown, ciphertext?: unknown }} */ (
    data
  );
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.encrypted === true &&
    typeof candidate.iv === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

/**
 * Imports a raw PRF secret directly as a non-extractable AES-256-GCM key —
 * no HKDF, since this app has exactly one use for it and PRF output is
 * already uniform.
 * @param {ArrayBuffer} prfSecret
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKeyFromPrfSecret(prfSecret) {
  if (prfSecret.byteLength !== AES_KEY_BYTES) {
    throw new Error(`PRF secret must be ${AES_KEY_BYTES} bytes, got ${prfSecret.byteLength}.`);
  }
  return crypto.subtle.importKey("raw", prfSecret, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * @param {CryptoKey} key
 * @param {unknown} plainObject
 * @returns {Promise<{ encrypted: true, v: number, iv: string, ciphertext: string }>}
 */
export async function encryptBackupPayload(key, plainObject) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(plainObject));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    encrypted: true,
    v: ENCRYPTED_BACKUP_VERSION,
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

/**
 * Wraps every failure mode (unrecognized version, malformed base64url, GCM
 * auth-tag mismatch, JSON.parse failure) in BackupDecryptError, so callers
 * only ever need one instanceof check.
 * @param {CryptoKey} key
 * @param {unknown} envelope
 * @returns {Promise<unknown>}
 */
export async function decryptBackupPayload(key, envelope) {
  if (!isEncryptedEnvelope(envelope)) {
    throw new BackupDecryptError("Not an encrypted backup envelope.");
  }
  const { v, iv, ciphertext } = /** @type {{ v: unknown, iv: string, ciphertext: string }} */ (
    envelope
  );
  if (v !== ENCRYPTED_BACKUP_VERSION) {
    throw new BackupDecryptError(`Unrecognized encrypted backup version: ${v}`);
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: /** @type {BufferSource} */ (base64UrlDecode(iv)) },
      key,
      /** @type {BufferSource} */ (base64UrlDecode(ciphertext)),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (err) {
    throw new BackupDecryptError(
      err instanceof Error ? err.message : "Failed to decrypt backup.",
    );
  }
}
