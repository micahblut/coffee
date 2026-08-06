// Secrets set via `wrangler secret put` are invisible to `wrangler types` —
// it only generates types for bindings declared in wrangler.toml (like the
// caffe_backups D1 binding). Declared here by hand instead; this merges
// with the generated `interface Env` in worker-configuration.d.ts via
// TypeScript's normal interface declaration merging.
interface Env {
  PASSWORDLESS_API_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  INVITE_CODE_SALT: string;
}
