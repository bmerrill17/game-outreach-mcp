export interface TemplateRow {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
}

// Reflects the post-0002 schema. PII fields are at-rest encrypted under the
// per-user AES-GCM key derived from the request's API-key headers.
export interface SentEmailRow {
  id: string;
  user_id: string;
  contact_email_fp: string;        // HMAC fingerprint, deterministic per-user
  contact_email_ct: string;        // AES-GCM ciphertext (base64)
  channel_url_ct: string | null;
  channel_name_ct: string | null;
  game_id: string;
  template_name: string;
  sent_at: string;
  sent_via: string | null;
  notes_ct: string | null;
}

export interface OutreachSummaryRow {
  game_id: string;
  template_name: string;
  total_sends: number;
  unique_contacts: number;
  last_sent_at: string;
}
