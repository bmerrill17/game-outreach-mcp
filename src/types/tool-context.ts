import type { D1Database } from "@cloudflare/workers-types";
import type { UserCrypto } from "../lib/crypto";

export interface ToolContext {
  userId: string;
  tavilyKey: string;
  youtubeKey: string;
  db: D1Database;
  crypto: UserCrypto;
}
