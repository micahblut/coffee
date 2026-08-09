// Secrets set via `wrangler secret put` are invisible to `wrangler types` —
// it only generates types for bindings declared in wrangler.toml (like the
// caffe_backups D1 binding). Declared here by hand instead; this merges
// with the generated `interface Env` in worker-configuration.d.ts via
// TypeScript's normal interface declaration merging.
interface Env {
  PASSWORDLESS_API_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  INVITE_CODE_SALT: string;
  // Non-secret by design (see backup-crypto.js) but held here rather than as
  // a client-code constant so changing it is a deliberate server action, not
  // an easy-to-miss edit buried in application source. Must never change
  // once any account has an encrypted backup — doing so orphans it.
  BACKUP_PRF_SALT: string;
}
