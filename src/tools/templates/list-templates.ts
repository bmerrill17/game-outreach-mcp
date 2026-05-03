import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { toolError, toolSuccess } from "../../lib/errors";
import { clampLimit, decodeCursor, paginate } from "../../lib/pagination";
import type { TemplateRow } from "../../db";

type TemplateSummary = Pick<
  TemplateRow,
  "id" | "name" | "subject" | "created_at" | "updated_at"
>;

const InputSchema = {
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
    .describe("Max templates per page (default 25, hard cap 100)."),
};

const TemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const OutputSchema = {
  count: z.number(),
  templates: z.array(TemplateSummarySchema),
  nextCursor: z.string().nullable(),
};

export function registerListTemplates(server: McpServer, getCtx: () => ToolContext): void {
  server.registerTool(
    "list_templates",
    {
      title: "List Templates",
      description:
        "Returns the current user's outreach templates, ordered by creation time descending. Paginated via opaque cursor — pass `nextCursor` from a previous response to fetch the next page. Use this to discover available templates before starting an outreach run.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cursor, limit }) => {
      const ctx = getCtx();
      const offset = decodeCursor(cursor);
      const pageSize = clampLimit(limit);

      try {
        const result = await ctx.db
          .prepare(
            "SELECT id, name, subject, created_at, updated_at FROM templates WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
          )
          .bind(ctx.userId, pageSize + 1, offset)
          .all<TemplateSummary>();

        const { items, nextCursor } = paginate(result.results, offset, pageSize);

        return toolSuccess({
          count: items.length,
          templates: items,
          nextCursor,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to list templates");
      }
    },
  );
}
