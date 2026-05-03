import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { getTemplate } from "../../db";
import { toolError, toolSuccess } from "../../lib/errors";

const InputSchema = {
  name: z.string().describe("Semantic name of the template to retrieve"),
};

const OutputSchema = {
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
};

export function registerGetTemplate(server: McpServer, getCtx: () => ToolContext): void {
  server.registerTool(
    "get_template",
    {
      title: "Get Template",
      description:
        "Retrieves a specific template by its semantic name. Returns the full template including subject and body with placeholders intact.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      const ctx = getCtx();
      const template = await getTemplate(ctx.db, ctx.userId, name);
      if (!template) return toolError(`Template "${name}" not found.`);
      return toolSuccess(template);
    },
  );
}
