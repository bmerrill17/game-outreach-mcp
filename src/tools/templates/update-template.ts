import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { getTemplate } from "../../db";
import { toolError, toolSuccess } from "../../lib/errors";

export const UpdateTemplateSchema = {
  name: z.string().describe("Semantic name of the template to update"),
  subject: z
    .string()
    .min(1)
    .optional()
    .describe("New subject line — omit to keep existing"),
  body: z.string().min(1).optional().describe("New body — omit to keep existing"),
};

export function registerUpdateTemplate(server: McpServer, getCtx: () => ToolContext): void {
  server.tool(
    "update_template",
    "Updates an existing template's subject or body. Provide only the fields you want to change. Template name cannot be changed — delete and recreate if a rename is needed.",
    UpdateTemplateSchema,
    async ({ name, subject, body }) => {
      const ctx = getCtx();
      const existing = await getTemplate(ctx.db, ctx.userId, name);
      if (!existing) return toolError(`Template "${name}" not found.`);

      if (subject === undefined && body === undefined) {
        return toolError("Provide at least one of: subject, body");
      }

      const newSubject = subject ?? existing.subject;
      const newBody = body ?? existing.body;
      const now = new Date().toISOString();

      await ctx.db
        .prepare(
          "UPDATE templates SET subject = ?, body = ?, updated_at = ? WHERE user_id = ? AND name = ?",
        )
        .bind(newSubject, newBody, now, ctx.userId, name)
        .run();

      return toolSuccess({ name, subject: newSubject, body: newBody, updated_at: now });
    },
  );
}
