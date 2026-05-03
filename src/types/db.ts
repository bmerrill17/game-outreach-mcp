export interface TemplateRow {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface SentEmailRow {
  id: string;
  user_id: string;
  contact_email: string;
  channel_url: string | null;
  channel_name: string | null;
  game_id: string;
  template_name: string;
  sent_at: string;
  sent_via: string | null;
  notes: string | null;
}

export interface OutreachSummaryRow {
  game_id: string;
  template_name: string;
  total_sends: number;
  unique_contacts: number;
  last_sent_at: string;
}
