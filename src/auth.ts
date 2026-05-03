import type { Context } from "hono";
import type { Env } from "./types/env";

export interface UserContext {
  userId: string;
  tavilyKey: string;
  youtubeKey: string;
}

export type AuthResult = UserContext | { error: string };

export async function extractUserContext(
  c: Context<{ Bindings: Env }>,
): Promise<AuthResult> {
  const tavilyKey = c.req.header("x-tavily-key");
  const youtubeKey = c.req.header("x-youtube-key");

  if (!tavilyKey || !youtubeKey) {
    return {
      error: [
        "Missing required headers.",
        !tavilyKey ? "x-tavily-key is required. Get a free key at tavily.com" : null,
        !youtubeKey
          ? "x-youtube-key is required. Get a free key at console.cloud.google.com (YouTube Data API v3)"
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  // Stable userId from key pair — no storage needed
  const raw = `${tavilyKey}:${youtubeKey}`;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const userId = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);

  return { userId, tavilyKey, youtubeKey };
}
