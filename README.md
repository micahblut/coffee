# caffè quotidiano

A local-first coffee logbook. Track the bags you're working through, log every
brew, and see what actually tastes good — installable as a PWA, works
offline, and keeps all your data on your own device.

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
- **Installable PWA** — add it to your home screen and use it offline; all
  data lives in the browser's IndexedDB, nothing is sent to a server.

## Tech stack

Vanilla JS/HTML/CSS with JSDoc type annotations, checked by TypeScript in
`--checkJs` mode (no transpilation). Data is stored locally via
[Dexie](https://dexie.org/) on top of IndexedDB. There's no build step or
bundler — the app runs directly from static files, and Dexie is vendored in
`src/vendor/` (see `src/vendor/README.md`) rather than pulled in as a runtime
npm dependency.

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

## Scripts

- `npm run dev` — start the local dev server
- `npm run typecheck` — type-check the codebase with TypeScript
- `npm test` — run the test suite (Node's built-in test runner, with
  `fake-indexeddb` standing in for the browser's IndexedDB)

## Project structure

```
src/
  main.js          app shell: navigation, modals, bottom nav
  db/db.js         Dexie schema, queries, import/export
  models/types.js  JSDoc type definitions for all records
  views/           one file per screen (home, coffee, equipment, settings, ...)
  utils/           small shared helpers (e.g. date math)
  vendor/          vendored third-party files (Dexie)
scripts/
  dev-server.js    zero-dependency static file server used by `npm run dev`
test/
  db.test.js       tests for src/db/db.js
```

## License

MIT — see [LICENSE](LICENSE) — except the vendored files in `src/vendor/`
(Dexie, the Passwordless.dev client SDK), which are Apache License 2.0; see
`src/vendor/README.md` for attribution details.
