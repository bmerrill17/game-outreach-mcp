import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { toolError, toolSuccess } from "../../lib/errors";

export const CreateTemplateSchema = {
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, {
      message:
        "Template name must be lowercase alphanumeric with hyphens only e.g. initial-outreach",
    })
    .describe(
      "Semantic name for this template e.g. 'initial-outreach', 'follow-up-7day', 'review-request'",
    ),
  subject: z
    .string()
    .min(1)
    .describe(
      "Email subject line. Supports {{channel_name}} and {{game_name}} placeholders.",
    ),
  body: z
    .string()
    .min(1)
    .describe(
      "Email body. Supports {{channel_name}}, {{game_name}}, and {{hook}} placeholders. The {{hook}} placeholder is where the agent inserts the personalised game-to-channel connection paragraph.",
    ),
};

export function registerCreateTemplate(server: McpServer, getCtx: () => ToolContext): void {
  server.tool(
    "create_template",
    "Creates a new outreach email template with a semantic name. Template names must be unique per user and use lowercase-hyphenated format. Use {{hook}} in the body where personalised content should be inserted by the agent at send time.",
    CreateTemplateSchema,
    async ({ name, subject, body }) => {
      const ctx = getCtx();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      try {
        await ctx.db
          .prepare(
            "INSERT INTO templates (id, user_id, name, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(id, ctx.userId, name, subject, body, now, now)
          .run();

        return toolSuccess({ id, name, subject, body, created_at: now });
      } catch (err) {
        if (err instanceof Error && /UNIQUE/i.test(err.message)) {
          return toolError(
            `Template with name "${name}" already exists. Use update_template to modify it.`,
          );
        }
        return toolError(err instanceof Error ? err.message : "Failed to create template");
      }
    },
  );
}
