import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { toolError, toolSuccess } from "../../lib/errors";

const InputSchema = {
  contact_email: z.string().email().describe("Email address that was sent to"),
  game_id: z.string().describe("Steam app ID of the game being pitched"),
  template_name: z.string().describe("Semantic name of the template that was sent"),
  channel_url: z.string().url().optional().describe("YouTube channel URL if applicable"),
  channel_name: z.string().optional().describe("Display name of the channel"),
  sent_via: z
    .string()
    .optional()
    .describe("Informational — which email tool was used e.g. 'gmail', 'resend'"),
  notes: z
    .string()
    .optional()
    .describe(
      "Any additional context to record e.g. personalisation notes, hook used",
    ),
};

const OutputSchema = {
  recorded: z.literal(true),
  id: z.string(),
  contact_email: z.string(),
  game_id: z.string(),
  template_name: z.string(),
  sent_at: z.string(),
};

export function registerRecordSend(server: McpServer, getCtx: () => ToolContext): void {
  server.registerTool(
    "record_send",
    {
      title: "Record Send",
      description:
        "Records a completed outreach email send to the tracking history. Call this immediately after a successful send via your email MCP. This is what prevents duplicate sends in future runs. Records are immutable — there is no delete or update for send history. PII fields (contact_email, channel_url, channel_name, notes) are encrypted at rest under a key derived from your API headers.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false, // append-only
        idempotentHint: false, // each call appends a new row
        openWorldHint: false,
      },
    },
    async ({
      contact_email,
      game_id,
      template_name,
      channel_url,
      channel_name,
      sent_via,
      notes,
    }) => {
      const ctx = getCtx();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      try {
        // Compute fingerprint + ciphertexts in parallel — all four crypto ops
        // are independent and the AES-GCM nonces are random per call.
        const [emailFp, emailCt, urlCt, nameCt, notesCt] = await Promise.all([
          ctx.crypto.fingerprint(contact_email),
          ctx.crypto.encrypt(contact_email),
          channel_url ? ctx.crypto.encrypt(channel_url) : Promise.resolve(null),
          channel_name ? ctx.crypto.encrypt(channel_name) : Promise.resolve(null),
          notes ? ctx.crypto.encrypt(notes) : Promise.resolve(null),
        ]);

        await ctx.db
          .prepare(
            `INSERT INTO sent_emails
              (id, user_id, contact_email_fp, contact_email_ct, channel_url_ct,
               channel_name_ct, game_id, template_name, sent_at, sent_via, notes_ct)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            ctx.userId,
            emailFp,
            emailCt,
            urlCt,
            nameCt,
            game_id,
            template_name,
            now,
            sent_via ?? null,
            notesCt,
          )
          .run();

        return toolSuccess({
          recorded: true as const,
          id,
          // Echo the cleartext email back — agent passed it in, no privacy gain
          // from withholding it on the response side.
          contact_email,
          game_id,
          template_name,
          sent_at: now,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to record send");
      }
    },
  );
}
