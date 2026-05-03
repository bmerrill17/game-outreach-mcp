import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { toolError, toolSuccess } from "../../lib/errors";
import type { OutreachSummaryRow } from "../../types/db";

export const GetOutreachSummarySchema = {
  game_id: z
    .string()
    .optional()
    .describe(
      "Filter to a specific game by Steam app ID. Omit to get summary across all games.",
    ),
};

const SUMMARY_SELECT = `
  game_id,
  template_name,
  COUNT(*) AS total_sends,
  COUNT(DISTINCT contact_email) AS unique_contacts,
  MAX(sent_at) AS last_sent_at
`;

export function registerGetOutreachSummary(
  server: McpServer,
  getCtx: () => ToolContext,
): void {
  server.tool(
    "get_outreach_summary",
    "Returns a summary of outreach activity grouped by game and template. Shows total sends, most recent send date, and unique contacts reached. Use this to understand campaign coverage before starting a new outreach run.",
    GetOutreachSummarySchema,
    async ({ game_id }) => {
      const ctx = getCtx();

      try {
        const result = game_id
          ? await ctx.db
              .prepare(
                `SELECT ${SUMMARY_SELECT}
                 FROM sent_emails
                 WHERE user_id = ? AND game_id = ?
                 GROUP BY game_id, template_name
                 ORDER BY last_sent_at DESC`,
              )
              .bind(ctx.userId, game_id)
              .all<OutreachSummaryRow>()
          : await ctx.db
              .prepare(
                `SELECT ${SUMMARY_SELECT}
                 FROM sent_emails
                 WHERE user_id = ?
                 GROUP BY game_id, template_name
                 ORDER BY last_sent_at DESC`,
              )
              .bind(ctx.userId)
              .all<OutreachSummaryRow>();

        return toolSuccess({
          total_records: result.results.length,
          summary: result.results,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to fetch summary");
      }
    },
  );
}
