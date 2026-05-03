import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/tool-context";
import type { TemplateRow } from "../db";
import { getTemplate } from "../db";

// Templates are exposed as MCP Resources in addition to being CRUD-able via tools.
// Tools are for *actions* (create/update/delete/get); resources are for *readable
// state the agent may want to enumerate as context*. Modeling templates both ways
// lets clients that surface resources (e.g. an "@-mention" picker) treat them as
// first-class context, without losing the imperative tool API.
//
// URI scheme: template://<semantic-name>
// MIME:       text/plain (the body, with placeholders intact)

export function registerTemplateResources(
  server: McpServer,
  getCtx: () => ToolContext,
): void {
  server.registerResource(
    "templates",
    new ResourceTemplate("template://{name}", {
      list: async () => {
        const ctx = getCtx();
        const result = await ctx.db
          .prepare(
            "SELECT name, subject FROM templates WHERE user_id = ? ORDER BY created_at DESC",
          )
          .bind(ctx.userId)
          .all<Pick<TemplateRow, "name" | "subject">>();

        return {
          resources: result.results.map((row) => ({
            uri: `template://${row.name}`,
            name: row.name,
            title: row.subject,
            description: `Outreach template: ${row.name}`,
            mimeType: "text/plain",
          })),
        };
      },
      complete: {
        // Autocomplete `name` against existing template names — supports IDE-style
        // resource pickers in clients that implement completion.
        name: async (partial) => {
          const ctx = getCtx();
          const result = await ctx.db
            .prepare(
              "SELECT name FROM templates WHERE user_id = ? AND name LIKE ? ORDER BY name LIMIT 20",
            )
            .bind(ctx.userId, `${partial}%`)
            .all<{ name: string }>();
          return result.results.map((r) => r.name);
        },
      },
    }),
    {
      title: "Outreach Templates",
      description:
        "User-defined email templates. Each template has a semantic name and contains {{placeholders}} the agent substitutes at send time.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const ctx = getCtx();
      const name = Array.isArray(variables.name) ? variables.name[0] : variables.name;
      if (!name) {
        throw new Error(`Invalid template URI: ${uri.href}`);
      }

      const template = await getTemplate(ctx.db, ctx.userId, name);
      if (!template) {
        throw new Error(`Template not found: ${name}`);
      }

      // Return body as the plain-text representation; subject + metadata via JSON
      // sibling content block so clients can show both without a second roundtrip.
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: template.body,
          },
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                name: template.name,
                subject: template.subject,
                body: template.body,
                created_at: template.created_at,
                updated_at: template.updated_at,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
