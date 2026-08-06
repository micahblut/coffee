# caffè quotidiano — cloud backup API

A small Cloudflare Worker providing optional, opt-in cloud backup for the
main app

## Development

```sh
npm install
npx wrangler dev
```

`wrangler dev` runs the Worker locally (with a local D1 instance)

## Scripts

- `npm test` — run the test suite (Node's built-in test runner)
- `npm run typecheck` — type-check `src/` against Cloudflare's
  project-generated Workers types, and `test/` separately against Node's
  types (these two run under genuinely different global type environments —
  see the two `tsconfig*.json` files)
- `npx wrangler deploy` — deploy to `api.coffee.blut.dev`
- `npx wrangler d1 execute caffe-backups --remote --file=<path>` — run a
  SQL file against the live D1 database (used for `schema.sql` and
  `seed-invite-code.sql`)

## Project structure

```
src/
  index.js        router — dispatches each path/method to a handler
  handlers.js      endpoint logic (register, login, session, backup, logout)
  lib.js           shared helpers: CORS, cookies, hashing, session lookup
  passwordless.js  server-side calls to the Passwordless.dev REST API
  turnstile.js     server-side Turnstile siteverify call
  env.d.ts         hand-declared types for secrets `wrangler types` can't see
test/
  lib.test.js      tests for the pure helpers in lib.js
schema.sql          D1 schema (invite_codes, users, sessions, backups, rate_limit_counters)
seed-invite-code.sql  example of the invite-code insert shape (hashed, never plaintext)
wrangler.toml       Worker config: D1 binding, custom domain route
```

## Secrets

Three secrets the Worker reads at runtime — none of them live in this
repo or in `wrangler.toml`:

- `PASSWORDLESS_API_SECRET` — Passwordless.dev private API key
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile secret key
- `INVITE_CODE_SALT` — salt for hashing invite codes before storing them

Set via `wrangler secret put <NAME>`, stored in Cloudflare's encrypted
Worker secret store.

## Security notes

- Invite-code gated registration, no email/username collected — see the
  main [README](../README.md) and `src/vendor/README.md` for the broader
  design rationale (usernameless/discoverable-credential passkeys, why
  sessions are httpOnly cookies rather than bearer tokens, etc.).
- Every Turnstile/Passwordless.dev token is re-verified server-side —
  never trust a client-supplied "this passed" flag.
- D1 queries are parameterized throughout.
