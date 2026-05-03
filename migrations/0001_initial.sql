-- Templates: user-defined outreach templates with semantic names.
-- Templates are user-authored content (not third-party PII) so they're stored
-- in plaintext for searchability and direct inspection.
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,           -- semantic name, user-defined, e.g. "initial-outreach"
  subject     TEXT NOT NULL,           -- email subject, supports {{channel_name}} {{game_name}}
  body        TEXT NOT NULL,           -- email body, supports {{channel_name}} {{game_name}} {{hook}}
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(user_id, name)                -- template names are unique per user
);

-- Sent history: immutable log of every send event. Third-party PII fields
-- (contact_email, channel_url, channel_name, notes) are stored encrypted under
-- a per-user key derived from the request's API headers via HKDF-SHA256.
--   *_fp columns hold a deterministic HMAC fingerprint for SQL dedup matching.
--   *_ct columns hold AES-GCM ciphertext (base64, includes nonce) for retrieval.
-- See src/lib/crypto.ts for the derivation and src/types/db.ts for the row shape.
CREATE TABLE IF NOT EXISTS sent_emails (
  id                TEXT NOT NULL PRIMARY KEY,
  user_id           TEXT NOT NULL,
  contact_email_fp  TEXT NOT NULL,     -- HMAC fingerprint (hex), deterministic per-user
  contact_email_ct  TEXT NOT NULL,     -- AES-GCM ciphertext (base64), randomized
  channel_url_ct    TEXT,              -- ciphertext or NULL
  channel_name_ct   TEXT,              -- ciphertext or NULL
  game_id           TEXT NOT NULL,     -- public Steam app ID, NOT encrypted
  template_name     TEXT NOT NULL,     -- user's own semantic name, NOT encrypted
  sent_at           TEXT NOT NULL,
  sent_via          TEXT,              -- informational ("gmail", etc.), NOT encrypted
  notes_ct          TEXT               -- ciphertext or NULL
);

-- Indexes for the most common query patterns
CREATE INDEX IF NOT EXISTS idx_sent_user_game_template
  ON sent_emails(user_id, game_id, template_name);

CREATE INDEX IF NOT EXISTS idx_sent_user_contact_fp
  ON sent_emails(user_id, contact_email_fp);

CREATE INDEX IF NOT EXISTS idx_templates_user
  ON templates(user_id);
