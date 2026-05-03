-- Templates: user-defined outreach templates with semantic names
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

-- Sent history: immutable log of every send event
CREATE TABLE IF NOT EXISTS sent_emails (
  id             TEXT NOT NULL PRIMARY KEY,
  user_id        TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  channel_url    TEXT,
  channel_name   TEXT,
  game_id        TEXT NOT NULL,        -- Steam app ID
  template_name  TEXT NOT NULL,        -- semantic name at time of send
  sent_at        TEXT NOT NULL,
  sent_via       TEXT,                 -- informational: "gmail", "resend", etc.
  notes          TEXT                  -- optional freeform field for agent context
);

-- Indexes for the most common query patterns
CREATE INDEX IF NOT EXISTS idx_sent_user_game_template
  ON sent_emails(user_id, game_id, template_name);

CREATE INDEX IF NOT EXISTS idx_sent_user_contact
  ON sent_emails(user_id, contact_email);

CREATE INDEX IF NOT EXISTS idx_templates_user
  ON templates(user_id);
