import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  corsHeaders,
  sha256Hex,
  randomToken,
  getSessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionUserId,
  SESSION_TTL_SECONDS,
} from "../src/lib.js";

describe("sha256Hex", () => {
  test("matches Node's own SHA-256 for the same input", async () => {
    const expected = createHash("sha256").update("hello world").digest("hex");
    assert.equal(await sha256Hex("hello world"), expected);
  });

  test("is sensitive to every byte of the input", async () => {
    assert.notEqual(await sha256Hex("code1salt"), await sha256Hex("code2salt"));
  });
});

describe("randomToken", () => {
  test("is URL-safe (no +, /, or = padding)", () => {
    const token = randomToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  test("has enough length to reflect 32 bytes of entropy", () => {
    // 32 raw bytes -> 43 base64url characters (no padding).
    assert.equal(randomToken().length, 43);
  });

  test("is different on every call", () => {
    assert.notEqual(randomToken(), randomToken());
  });
});

describe("corsHeaders", () => {
  test("pins the origin to the real site, not a wildcard", () => {
    const headers = corsHeaders();
    assert.equal(headers["Access-Control-Allow-Origin"], "https://coffee.blut.dev");
    assert.equal(headers["Access-Control-Allow-Credentials"], "true");
  });
});

describe("getSessionToken", () => {
  test("extracts the session cookie from among others", () => {
    const request = new Request("https://api.coffee.blut.dev/session", {
      headers: { Cookie: "foo=bar; session=abc123; other=xyz" },
    });
    assert.equal(getSessionToken(request), "abc123");
  });

  test("returns undefined when there's no session cookie", () => {
    const request = new Request("https://api.coffee.blut.dev/session", {
      headers: { Cookie: "foo=bar" },
    });
    assert.equal(getSessionToken(request), undefined);
  });

  test("returns undefined when there's no Cookie header at all", () => {
    const request = new Request("https://api.coffee.blut.dev/session");
    assert.equal(getSessionToken(request), undefined);
  });
});

describe("sessionCookieHeader / clearSessionCookieHeader", () => {
  test("sets the security-relevant flags on a fresh session cookie", () => {
    const header = sessionCookieHeader("abc123", SESSION_TTL_SECONDS);
    assert.match(header, /^session=abc123;/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /Secure/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, new RegExp(`Max-Age=${SESSION_TTL_SECONDS}\\b`));
  });

  test("clears the cookie with Max-Age=0", () => {
    assert.match(clearSessionCookieHeader(), /Max-Age=0\b/);
  });
});

/**
 * Minimal stand-in for the one D1 query shape getSessionUserId needs —
 * not a full D1 emulation, just enough to drive this function's branches.
 * @param {{ token_hash: string, user_id: string, expires_at: string }[]} rows
 */
function fakeD1(rows) {
  return {
    caffe_backups: {
      prepare() {
        return {
          bind(tokenHash) {
            return {
              async first() {
                return rows.find((row) => row.token_hash === tokenHash) ?? null;
              },
            };
          },
        };
      },
    },
  };
}

describe("getSessionUserId", () => {
  test("returns the user id for a valid, unexpired session", async () => {
    const tokenHash = await sha256Hex("real-token");
    const env = fakeD1([
      {
        token_hash: tokenHash,
        user_id: "user-1",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ]);
    const request = new Request("https://api.coffee.blut.dev/session", {
      headers: { Cookie: "session=real-token" },
    });
    assert.equal(await getSessionUserId(request, env), "user-1");
  });

  test("returns null for an expired session", async () => {
    const tokenHash = await sha256Hex("stale-token");
    const env = fakeD1([
      {
        token_hash: tokenHash,
        user_id: "user-1",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    const request = new Request("https://api.coffee.blut.dev/session", {
      headers: { Cookie: "session=stale-token" },
    });
    assert.equal(await getSessionUserId(request, env), null);
  });

  test("returns null when there's no matching session row", async () => {
    const env = fakeD1([]);
    const request = new Request("https://api.coffee.blut.dev/session", {
      headers: { Cookie: "session=unknown-token" },
    });
    assert.equal(await getSessionUserId(request, env), null);
  });

  test("returns null when there's no session cookie at all", async () => {
    const env = fakeD1([]);
    const request = new Request("https://api.coffee.blut.dev/session");
    assert.equal(await getSessionUserId(request, env), null);
  });
});
