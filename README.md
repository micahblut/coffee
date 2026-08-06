# caffè quotidiano

A local-first coffee logbook. Track the bags you're working through, log every
brew, and see what actually tastes good — installable as a PWA, works
offline, and keeps your data on your own device by default, with optional
passkey-secured cloud backup if you want it.

## Features

- **Bags & roasters** — log bags of coffee against the roaster you bought
  them from, with roast date, origin, process, and type (espresso/filter).
- **Brew logging** — record grind size, dose, yield, extraction time, water
  temperature, and a 1–5 rating for every brew.
- **Freshness insights** — a rating-vs-days-since-roast scatter plot per bag,
  so you can spot the sweet spot for how a bag ages.
- **Favorites** — roasters and bags ranked by average rating, so your best
  coffees surface on their own.
- **Equipment tracking** — grinders and brewers with configurable cleaning
  reminders, based on grind/brew count or elapsed time (whichever comes
  first).
- **Data export/import** — back up or move your whole log as a single JSON
  file.
- **Installable PWA** — add it to your home screen and use it offline; by
  default, all data lives in the browser's IndexedDB and nothing is sent
  anywhere.
- **Cloud backup (optional)** — sign in with a passkey (no email or
  password, ever) to back up automatically in the background and restore
  on a new device. Purely opt-in: skip it, and the app behaves exactly as
  it always has. See [Cloud backup](#cloud-backup-optional) below.

## Tech stack

Vanilla JS/HTML/CSS with JSDoc type annotations, checked by TypeScript in
`--checkJs` mode (no transpilation). Data is stored locally via
[Dexie](https://dexie.org/) on top of IndexedDB. There's no build step or
bundler — the app runs directly from static files, and Dexie is vendored in
`src/vendor/` (see `src/vendor/README.md`) rather than pulled in as a runtime
npm dependency.

The optional cloud backup feature is a separate small backend (`worker/` —
see [worker/README.md](worker/README.md)): a Cloudflare Worker + D1 for
storage, [Bitwarden Passwordless.dev](https://bitwarden.com/products/passwordless/)
for passkey (WebAuthn) auth, and Cloudflare Turnstile to gate registration
against spam. It doesn't change the root app's buildless philosophy — the
frontend pieces that talk to it (`src/api/`, `src/sync/`) are still plain
static JS, and the Passwordless.dev client SDK is vendored the same way
Dexie is.

## Development

The steps below are only for running the app locally or contributing —
there's no build step, so a hosted copy (e.g. GitHub Pages) needs nothing
from a visitor beyond opening the page.

```sh
npm install
npm run dev
```

This starts a small static file server (`scripts/dev-server.js`) at
`http://localhost:5173/`. Since there's no build step, just refresh the page
after editing any file.

These commands only cover the root app. The optional cloud backup backend
(`worker/`) is a separate npm project with its own dependencies, dev
server, and deploy step — see [worker/README.md](worker/README.md).

## Scripts

Root app:

- `npm run dev` — start the local dev server
- `npm run typecheck` — type-check the codebase with TypeScript
- `npm test` — run the test suite (Node's built-in test runner, with
  `fake-indexeddb` standing in for the browser's IndexedDB)
- `node scripts/update-vendored-deps.js` — re-vendor `src/vendor/`'s
  third-party files from their latest npm versions (see
  `src/vendor/README.md`); also run weekly by a GitHub Actions workflow that
  opens a PR when it finds an actual update

`worker/` has its own `npm test`, `npm run typecheck`, and Wrangler-based
dev/deploy commands — see [worker/README.md](worker/README.md).

## Cloud backup (optional)

Signing in (Settings → "Set up cloud backup") registers a passkey and
backs up your data to a small Cloudflare-hosted API — automatically, in
the background, a few seconds after any local edit. Restoring on a new
device replaces that device's local data with the latest backup, same as
the existing file-based import already does.

A few things by design:

- **No email, no password, ever.** Registration is gated by an
  invite code (this isn't an open-signup product), and the account itself
  is an opaque random ID with a passkey attached — nothing resembling
  personal data is collected or could leak.
- **Fully opt-in, zero effect otherwise.** If you never open that Settings
  section, the app makes no network calls and behaves exactly as it did
  before this feature existed.
- **Backup, not sync.** Each device stays authoritative for its own local
  data; the cloud holds one latest snapshot per account, not a
  merged/synced view across devices.

See [worker/README.md](worker/README.md) for how the backend itself is
built and secured.

## Project structure

```
src/
  main.js          app shell: navigation, modals, bottom nav
  config.js        public config (API URL, Passwordless/Turnstile public keys)
  db/db.js         Dexie schema, queries, import/export
  models/types.js  JSDoc type definitions for all records
  views/           one file per screen (home, coffee, equipment, settings, ...)
  views/cloud-setup.js  passkey registration modal + sign-in-with-passkey
  api/client.js    fetch wrapper for the cloud backup Worker API
  sync/            session cache, backup/restore glue, debounced auto-sync
  utils/           small shared helpers (e.g. date math)
  vendor/          vendored third-party files (Dexie, Passwordless.dev client SDK)
scripts/
  dev-server.js           zero-dependency static file server used by `npm run dev`
  update-vendored-deps.js re-vendors src/vendor/'s third-party files
test/
  db.test.js       tests for src/db/db.js
  auto-sync.test.js tests for src/sync/auto-sync.js
worker/            optional cloud backup backend — separate project, see worker/README.md
.github/workflows/
  update-vendored-deps.yml  weekly check for vendored dependency updates
```

## License

MIT — see [LICENSE](LICENSE) — except the vendored files in `src/vendor/`
(Dexie, the Passwordless.dev client SDK), which are Apache License 2.0; see
`src/vendor/README.md` for attribution details.
