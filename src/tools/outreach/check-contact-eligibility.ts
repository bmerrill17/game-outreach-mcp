import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { toolError, toolSuccess } from "../../lib/errors";

export const CheckContactEligibilitySchema = {
  contacts: z
    .array(
      z.object({
        email: z.string().email(),
        channel_url: z.string().url().optional(),
        channel_name: z.string().optional(),
      }),
    )
    .min(1)
    .describe("List of contacts to check"),
  template_name: z
    .string()
    .describe(
      "Semantic template name to check against — contacts who have already received this template for this game are excluded",
    ),
  game_id: z
    .string()
    .describe(
      "Steam app ID for the game — deduplication is scoped per game so the same contact can receive outreach for different games",
    ),
};

export function registerCheckContactEligibility(
  server: McpServer,
  getCtx: () => ToolContext,
): void {
  server.tool(
    "check_contact_eligibility",
    "Filters a list of contacts to only those who have NOT yet been sent a specific template for a specific game. Returns both eligible and skipped lists with reasons. Always call this before any outreach run to prevent duplicate sends.",
    CheckContactEligibilitySchema,
    async ({ contacts, template_name, game_id }) => {
      const ctx = getCtx();

      try {
        const history = await ctx.db
          .prepare(
            "SELECT contact_email, sent_at FROM sent_emails WHERE user_id = ? AND game_id = ? AND template_name = ?",
          )
          .bind(ctx.userId, game_id, template_name)
          .all<{ contact_email: string; sent_at: string }>();

        const sentMap = new Map(history.results.map((r) => [r.contact_email, r.sent_at]));

        const eligible = contacts.filter((c) => !sentMap.has(c.email));
        const skipped = contacts
          .filter((c) => sentMap.has(c.email))
          .map((c) => ({ ...c, previously_sent_at: sentMap.get(c.email) ?? null }));

        return toolSuccess({
          eligible_count: eligible.length,
          skipped_count: skipped.length,
          eligible,
          skipped,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Eligibility check failed");
      }
    },
  );
}
