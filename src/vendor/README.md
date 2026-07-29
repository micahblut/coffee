Vendored third-party files, unmodified, checked in so the app runs from static files with no build step and no runtime npm dependency.

- `dexie.mjs` / `dexie.d.mts` — Dexie 4.4.4, copied from `node_modules/dexie/dist/dexie.mjs` and `dexie.d.ts` (renamed to `.d.mts` so TypeScript pairs it with the `.mjs` file automatically) after `npm install dexie@4.4.4 --no-save`. To upgrade: install the new version the same way, diff the two files, then replace.
