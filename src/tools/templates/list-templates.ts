import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { toolError, toolSuccess } from "../../lib/errors";
import type { TemplateRow } from "../../db";

type TemplateSummary = Pick<
  TemplateRow,
  "id" | "name" | "subject" | "created_at" | "updated_at"
>;

export function registerListTemplates(server: McpServer, getCtx: () => ToolContext): void {
  server.tool(
    "list_templates",
    "Returns all outreach templates for the current user. Use this to discover available templates before starting an outreach run.",
    {},
    async () => {
      const ctx = getCtx();
      try {
        const result = await ctx.db
          .prepare(
            "SELECT id, name, subject, created_at, updated_at FROM templates WHERE user_id = ? ORDER BY created_at DESC",
          )
          .bind(ctx.userId)
          .all<TemplateSummary>();

        return toolSuccess({ count: result.results.length, templates: result.results });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to list templates");
      }
    },
  );
}
