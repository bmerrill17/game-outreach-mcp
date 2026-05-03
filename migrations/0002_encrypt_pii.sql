-- Migration 0002: encrypt PII fields at rest.
--
-- Replaces the plaintext `contact_email` (and the unencrypted channel/notes
-- fields) with:
--   - contact_email_fp  HMAC-SHA256 fingerprint, used for dedup matching
--   - contact_email_ct  AES-GCM ciphertext, used for retrieval
--   - channel_url_ct, channel_name_ct, notes_ct  AES-GCM ciphertext or NULL
--
-- This migration is DESTRUCTIVE: existing rows in `sent_emails` cannot be
-- migrated because the encryption key is derived from the user's API keys,
-- which the server does not store. Any pre-migration send history is lost on
-- apply. Templates are unaffected.

DROP TABLE IF EXISTS sent_emails;

CREATE TABLE sent_emails (
  id                TEXT NOT NULL PRIMARY KEY,
  user_id           TEXT NOT NULL,
  contact_email_fp  TEXT NOT NULL,           -- HMAC fingerprint (hex), deterministic per-user
  contact_email_ct  TEXT NOT NULL,           -- AES-GCM ciphertext (base64), randomized
  channel_url_ct    TEXT,                    -- ciphertext or NULL
  channel_name_ct   TEXT,                    -- ciphertext or NULL
  game_id           TEXT NOT NULL,           -- public Steam app ID, NOT encrypted
  template_name     TEXT NOT NULL,           -- user's own semantic name, NOT encrypted
  sent_at           TEXT NOT NULL,
  sent_via          TEXT,                    -- informational ("gmail", etc.), NOT encrypted
  notes_ct          TEXT                     -- ciphertext or NULL
);

CREATE INDEX IF NOT EXISTS idx_sent_user_game_template
  ON sent_emails(user_id, game_id, template_name);

CREATE INDEX IF NOT EXISTS idx_sent_user_contact_fp
  ON sent_emails(user_id, contact_email_fp);
