import type { D1Database } from "@cloudflare/workers-types";

export interface ToolContext {
  userId: string;
  tavilyKey: string;
  youtubeKey: string;
  db: D1Database;
}
