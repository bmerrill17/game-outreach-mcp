import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { toolError, toolSuccess } from "../../lib/errors";
import { clampLimit, decodeCursor, paginate } from "../../lib/pagination";
import type { OutreachSummaryRow } from "../../types/db";

const InputSchema = {
  game_id: z
    .string()
    .optional()
    .describe(
      "Filter to a specific game by Steam app ID. Omit to get summary across all games.",
    ),
  cursor: z
    .string()
    .optional()
    .describe("Opaque pagination cursor returned by a previous call. Omit for the first page."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max summary rows per page (default 25, hard cap 100)."),
};

const SummaryRowSchema = z.object({
  game_id: z.string(),
  template_name: z.string(),
  total_sends: z.number(),
  unique_contacts: z.number(),
  last_sent_at: z.string(),
});

const OutputSchema = {
  count: z.number(),
  summary: z.array(SummaryRowSchema),
  nextCursor: z.string().nullable(),
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
  server.registerTool(
    "get_outreach_summary",
    {
      title: "Get Outreach Summary",
      description:
        "Returns a summary of outreach activity grouped by game and template. Shows total sends, most recent send date, and unique contacts reached. Use this to understand campaign coverage before starting a new outreach run. Paginated via opaque cursor.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ game_id, cursor, limit }) => {
      const ctx = getCtx();
      const offset = decodeCursor(cursor);
      const pageSize = clampLimit(limit);

      try {
        const result = game_id
          ? await ctx.db
              .prepare(
                `SELECT ${SUMMARY_SELECT}
                 FROM sent_emails
                 WHERE user_id = ? AND game_id = ?
                 GROUP BY game_id, template_name
                 ORDER BY last_sent_at DESC
                 LIMIT ? OFFSET ?`,
              )
              .bind(ctx.userId, game_id, pageSize + 1, offset)
              .all<OutreachSummaryRow>()
          : await ctx.db
              .prepare(
                `SELECT ${SUMMARY_SELECT}
                 FROM sent_emails
                 WHERE user_id = ?
                 GROUP BY game_id, template_name
                 ORDER BY last_sent_at DESC
                 LIMIT ? OFFSET ?`,
              )
              .bind(ctx.userId, pageSize + 1, offset)
              .all<OutreachSummaryRow>();

        const { items, nextCursor } = paginate(result.results, offset, pageSize);

        return toolSuccess({
          count: items.length,
          summary: items,
          nextCursor,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to fetch summary");
      }
    },
  );
}
