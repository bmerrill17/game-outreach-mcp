import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { getTemplate } from "../../db";
import { toolError, toolSuccess } from "../../lib/errors";

export const DeleteTemplateSchema = {
  name: z.string().describe("Semantic name of the template to delete"),
};

export function registerDeleteTemplate(server: McpServer, getCtx: () => ToolContext): void {
  server.tool(
    "delete_template",
    "Permanently deletes a template. Send history referencing this template name is preserved — history records are immutable. This action cannot be undone.",
    DeleteTemplateSchema,
    async ({ name }) => {
      const ctx = getCtx();
      const existing = await getTemplate(ctx.db, ctx.userId, name);
      if (!existing) return toolError(`Template "${name}" not found.`);

      await ctx.db
        .prepare("DELETE FROM templates WHERE user_id = ? AND name = ?")
        .bind(ctx.userId, name)
        .run();

      return toolSuccess({ deleted: name });
    },
  );
}
