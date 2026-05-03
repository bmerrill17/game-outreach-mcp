import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { getTemplate } from "../../db";
import { toolError, toolSuccess } from "../../lib/errors";

export const GetTemplateSchema = {
  name: z.string().describe("Semantic name of the template to retrieve"),
};

export function registerGetTemplate(server: McpServer, getCtx: () => ToolContext): void {
  server.tool(
    "get_template",
    "Retrieves a specific template by its semantic name. Returns the full template including subject and body with placeholders intact.",
    GetTemplateSchema,
    async ({ name }) => {
      const ctx = getCtx();
      const template = await getTemplate(ctx.db, ctx.userId, name);
      if (!template) return toolError(`Template "${name}" not found.`);
      return toolSuccess(template);
    },
  );
}
