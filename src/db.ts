import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "./types/env";
import type { TemplateRow, SentEmailRow } from "./types/db";

export type { TemplateRow, SentEmailRow };

export function getDb(env: Env): D1Database {
  return env.DB;
}

export async function getTemplate(
  db: D1Database,
  userId: string,
  name: string,
): Promise<TemplateRow | null> {
  const result = await db
    .prepare("SELECT * FROM templates WHERE user_id = ? AND name = ?")
    .bind(userId, name)
    .first<TemplateRow>();
  return result ?? null;
}

/**
 * Returns raw sent_emails rows. Note that PII fields (contact_email_ct,
 * channel_url_ct, channel_name_ct, notes_ct) are AES-GCM ciphertext — callers
 * must decrypt with the requesting user's `UserCrypto` instance before exposing
 * any values to the agent.
 */
export async function getSentEmails(
  db: D1Database,
  userId: string,
  gameId: string,
  templateName: string,
): Promise<SentEmailRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM sent_emails WHERE user_id = ? AND game_id = ? AND template_name = ?",
    )
    .bind(userId, gameId, templateName)
    .all<SentEmailRow>();
  return result.results;
}
