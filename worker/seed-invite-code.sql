INSERT INTO invite_codes (id, code_hash, label, max_uses, use_count, created_at, expires_at, revoked_at)
VALUES (
  'dd25613a-f607-4b82-9116-84020310ba7c',
  'dc8f1be139d1a981dfc3e3306b022dcd208a9773d993b16a9bf6c14e45b60fd9',
  'owner Stage 1 test code',
  1,
  0,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  NULL,
  NULL
);
