#!/usr/bin/env node
// Re-vendors the third-party files in src/vendor/ from their latest published
// npm versions. Safe to run anytime by hand — if nothing's changed upstream,
// running this produces no git diff. See src/vendor/README.md for what's
// vendored, why, and each dependency's license/attribution.
//
// The scheduled "Check vendored dependency updates" GitHub Actions workflow
// runs this on a cron and opens a PR only when it actually changes something.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "../..");
const vendorDir = path.join(rootDir, "src/vendor");
const versionsPath = path.join(vendorDir, "versions.json");

const PACKAGES = [
  {
    name: "dexie",
    files: [
      { from: "dist/dexie.mjs", to: "dexie.mjs" },
      { from: "dist/dexie.d.ts", to: "dexie.d.mts" },
    ],
  },
  {
    name: "@passwordlessdev/passwordless-client",
    files: [
      { from: "dist/esm/passwordless.mjs", to: "passwordless-client.mjs" },
      { from: "dist/passwordless.d.ts", to: "passwordless-client.d.mts" },
    ],
  },
];

const versions = JSON.parse(readFileSync(versionsPath, "utf8"));

for (const pkg of PACKAGES) {
  console.log(`Installing latest ${pkg.name}...`);
  execSync(`npm install ${pkg.name}@latest --no-save`, {
    cwd: rootDir,
    stdio: "inherit",
  });

  const installedVersion = JSON.parse(
    readFileSync(
      path.join(rootDir, "node_modules", pkg.name, "package.json"),
      "utf8",
    ),
  ).version;

  for (const file of pkg.files) {
    copyFileSync(
      path.join(rootDir, "node_modules", pkg.name, file.from),
      path.join(vendorDir, file.to),
    );
  }

  versions[pkg.name] = installedVersion;
  console.log(`${pkg.name} -> ${installedVersion}`);
}

writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + "\n");
console.log("\nDone. Run `git status` / `git diff` to see if anything actually changed.");
