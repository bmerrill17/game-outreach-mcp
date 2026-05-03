import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { toolError, toolSuccess } from "../../lib/errors";
import { clampLimit, decodeCursor, paginate } from "../../lib/pagination";

// Aggregated row shape returned by SQL — all PII fields are still ciphertext
// here; we decrypt below before returning to the agent.
//
// AES-GCM uses a random nonce per encryption, so two calls to encrypt() over
// the same email produce different ciphertexts. MAX(contact_email_ct) returns
// any one of them — fine, it decrypts to the same plaintext under the user's
// AES key.
interface AggregatedContactRow {
  contact_email_fp: string;
  contact_email_ct: string;
  channel_url_ct: string | null;
  channel_name_ct: string | null;
  last_sent_at: string;
  templates_sent_csv: string;
}

const InputSchema = {
  game_id: z
    .string()
    .describe(
      "Steam app ID — required. The server scopes contact retrieval per game so an agent never inadvertently surfaces unrelated outreach.",
    ),
  template_name: z
    .string()
    .optional()
    .describe(
      "Optional: only return contacts who received this specific template for this game. Omit to get all contacts ever pitched for the game.",
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
    .describe("Max contacts per page (default 25, hard cap 100)."),
};

const ContactSchema = z.object({
  contact_email: z.string(),
  channel_url: z.string().nullable(),
  channel_name: z.string().nullable(),
  last_sent_at: z.string(),
  templates_sent: z.array(z.string()),
});

const OutputSchema = {
  count: z.number(),
  contacts: z.array(ContactSchema),
  nextCursor: z.string().nullable(),
};

const SELECT_DISTINCT_CONTACTS = `
  contact_email_fp,
  MAX(contact_email_ct) AS contact_email_ct,
  MAX(channel_url_ct)   AS channel_url_ct,
  MAX(channel_name_ct)  AS channel_name_ct,
  MAX(sent_at)          AS last_sent_at,
  GROUP_CONCAT(DISTINCT template_name) AS templates_sent_csv
`;

export function registerListSentContacts(
  server: McpServer,
  getCtx: () => ToolContext,
): void {
  server.registerTool(
    "list_sent_contacts",
    {
      title: "List Sent Contacts",
      description:
        "Returns distinct contacts previously pitched for a given game, grouped by contact_email, with their channel info and which templates have been sent to them. Use this to build a follow-up campaign — feed the result into check_contact_eligibility against your new template name to find who hasn't received the follow-up yet. Paginated via opaque cursor. Decryption happens server-side using a key derived from your API headers.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ game_id, template_name, cursor, limit }) => {
      const ctx = getCtx();
      const offset = decodeCursor(cursor);
      const pageSize = clampLimit(limit);

      try {
        const result = template_name
          ? await ctx.db
              .prepare(
                `SELECT ${SELECT_DISTINCT_CONTACTS}
                 FROM sent_emails
                 WHERE user_id = ? AND game_id = ? AND template_name = ?
                 GROUP BY contact_email_fp
                 ORDER BY last_sent_at DESC
                 LIMIT ? OFFSET ?`,
              )
              .bind(ctx.userId, game_id, template_name, pageSize + 1, offset)
              .all<AggregatedContactRow>()
          : await ctx.db
              .prepare(
                `SELECT ${SELECT_DISTINCT_CONTACTS}
                 FROM sent_emails
                 WHERE user_id = ? AND game_id = ?
                 GROUP BY contact_email_fp
                 ORDER BY last_sent_at DESC
                 LIMIT ? OFFSET ?`,
              )
              .bind(ctx.userId, game_id, pageSize + 1, offset)
              .all<AggregatedContactRow>();

        const { items, nextCursor } = paginate(result.results, offset, pageSize);

        // Decrypt each contact's PII fields. Done in parallel per-row to keep
        // latency bounded by the slowest decrypt rather than serialized.
        const contacts = await Promise.all(
          items.map(async (row) => {
            const [contact_email, channel_url, channel_name] = await Promise.all([
              ctx.crypto.decrypt(row.contact_email_ct),
              row.channel_url_ct ? ctx.crypto.decrypt(row.channel_url_ct) : Promise.resolve(null),
              row.channel_name_ct ? ctx.crypto.decrypt(row.channel_name_ct) : Promise.resolve(null),
            ]);

            return {
              contact_email,
              channel_url,
              channel_name,
              last_sent_at: row.last_sent_at,
              templates_sent: row.templates_sent_csv
                ? row.templates_sent_csv.split(",")
                : [],
            };
          }),
        );

        return toolSuccess({
          count: contacts.length,
          contacts,
          nextCursor,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to list contacts");
      }
    },
  );
}
