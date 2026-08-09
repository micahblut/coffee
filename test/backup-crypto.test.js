import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isEncryptedEnvelope,
  deriveKeyFromPrfSecret,
  encryptBackupPayload,
  decryptBackupPayload,
  BackupDecryptError,
  ENCRYPTED_BACKUP_VERSION,
} from "../src/sync/backup-crypto.js";

/**
 * @returns {ArrayBuffer} a fake 32-byte PRF secret
 */
function fakePrfSecret() {
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

describe("isEncryptedEnvelope", () => {
  test("true for a well-shaped envelope", () => {
    assert.equal(isEncryptedEnvelope({ encrypted: true, v: 1, iv: "a", ciphertext: "b" }), true);
  });

  test("false for a plain export object", () => {
    assert.equal(isEncryptedEnvelope({ exportVersion: 1, brews: [] }), false);
  });

  test("false for garbage input", () => {
    assert.equal(isEncryptedEnvelope(null), false);
    assert.equal(isEncryptedEnvelope(undefined), false);
    assert.equal(isEncryptedEnvelope("a string"), false);
    assert.equal(isEncryptedEnvelope(42), false);
    assert.equal(isEncryptedEnvelope({ encrypted: false, iv: "a", ciphertext: "b" }), false);
    assert.equal(isEncryptedEnvelope({ encrypted: true, iv: 1, ciphertext: "b" }), false);
  });
});

describe("deriveKeyFromPrfSecret", () => {
  test("imports a 32-byte secret as a usable AES-GCM key", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    assert.equal(key.type, "secret");
    assert.equal(key.algorithm.name, "AES-GCM");
    assert.equal(key.extractable, false);
  });

  test("rejects a secret of the wrong length", async () => {
    await assert.rejects(() => deriveKeyFromPrfSecret(new Uint8Array(16).buffer));
  });
});

describe("encryptBackupPayload / decryptBackupPayload", () => {
  test("round-trips a sample export-shaped object", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    const plain = { exportVersion: 1, exportedAt: "2026-01-01T00:00:00.000Z", brews: [{ id: "b1" }] };

    const envelope = await encryptBackupPayload(key, plain);
    assert.equal(envelope.encrypted, true);
    assert.equal(envelope.v, ENCRYPTED_BACKUP_VERSION);
    assert.equal(isEncryptedEnvelope(envelope), true);

    const decrypted = await decryptBackupPayload(key, envelope);
    assert.deepEqual(decrypted, plain);
  });

  test("throws BackupDecryptError for a wrong key", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    const wrongKey = await deriveKeyFromPrfSecret(fakePrfSecret());
    const envelope = await encryptBackupPayload(key, { hello: "world" });

    await assert.rejects(() => decryptBackupPayload(wrongKey, envelope), BackupDecryptError);
  });

  test("throws BackupDecryptError for a corrupted ciphertext", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    const envelope = await encryptBackupPayload(key, { hello: "world" });
    const corrupted = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + "abcd" };

    await assert.rejects(() => decryptBackupPayload(key, corrupted), BackupDecryptError);
  });

  test("throws BackupDecryptError for a corrupted iv", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    const envelope = await encryptBackupPayload(key, { hello: "world" });
    const corrupted = { ...envelope, iv: envelope.iv.slice(0, -2) + "zz" };

    await assert.rejects(() => decryptBackupPayload(key, corrupted), BackupDecryptError);
  });

  test("throws BackupDecryptError for an unrecognized version", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    const envelope = await encryptBackupPayload(key, { hello: "world" });

    await assert.rejects(
      () => decryptBackupPayload(key, { ...envelope, v: 999 }),
      BackupDecryptError,
    );
  });

  test("throws BackupDecryptError for a non-envelope", async () => {
    const key = await deriveKeyFromPrfSecret(fakePrfSecret());
    await assert.rejects(() => decryptBackupPayload(key, { hello: "world" }), BackupDecryptError);
  });
});
