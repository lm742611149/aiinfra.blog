-- Comments store. Apply with:
--   npx wrangler d1 execute aiinfra-comments --remote --file db/schema.sql
-- No raw IPs or e-mail addresses are stored: ip_hash is a salted SHA-256 used only for
-- rate limiting and bans; region is the coarse country/region Cloudflare reports.

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  region     TEXT,
  ip_hash    TEXT NOT NULL,
  ua         TEXT,
  status     TEXT NOT NULL DEFAULT 'approved',   -- approved | deleted
  created_at INTEGER NOT NULL                     -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments (slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_ip   ON comments (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS bans (
  ip_hash    TEXT PRIMARY KEY,
  reason     TEXT,
  created_at INTEGER NOT NULL
);
