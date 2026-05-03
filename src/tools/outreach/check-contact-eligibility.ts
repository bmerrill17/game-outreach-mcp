import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { toolError, toolSuccess } from "../../lib/errors";

const ContactInputSchema = z.object({
  email: z.string().email(),
  channel_url: z.string().url().optional(),
  channel_name: z.string().optional(),
});

const InputSchema = {
  contacts: z.array(ContactInputSchema).min(1).describe("List of contacts to check"),
  template_name: z
    .string()
    .describe(
      "Semantic template name to check against — contacts who have already received this template for this game are excluded",
    ),
  game_id: z
    .string()
    .describe(
      "Steam app ID for the game — deduplication is scoped per game so the same contact can receive outreach for different games",
    ),
};

const EligibleSchema = z.object({
  email: z.string(),
  channel_url: z.string().optional(),
  channel_name: z.string().optional(),
});

const SkippedSchema = EligibleSchema.extend({
  previously_sent_at: z.string().nullable(),
});

const OutputSchema = {
  eligible_count: z.number(),
  skipped_count: z.number(),
  eligible: z.array(EligibleSchema),
  skipped: z.array(SkippedSchema),
};

export function registerCheckContactEligibility(
  server: McpServer,
  getCtx: () => ToolContext,
): void {
  server.registerTool(
    "check_contact_eligibility",
    {
      title: "Check Contact Eligibility",
      description:
        "Filters a list of contacts to only those who have NOT yet been sent a specific template for a specific game. Returns both eligible and skipped lists with reasons. Always call this before any outreach run to prevent duplicate sends. Matching is performed against per-user HMAC fingerprints — your contact emails are never compared against another user's stored data.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ contacts, template_name, game_id }) => {
      const ctx = getCtx();

      try {
        // Fingerprint each input email under the user's HMAC key so we can
        // match against the stored fingerprint column without ever decrypting.
        const fingerprints = await Promise.all(
          contacts.map((c) => ctx.crypto.fingerprint(c.email)),
        );
        const indexedContacts = contacts.map((contact, i) => ({
          contact,
          fp: fingerprints[i]!,
        }));

        const history = await ctx.db
          .prepare(
            "SELECT contact_email_fp, sent_at FROM sent_emails WHERE user_id = ? AND game_id = ? AND template_name = ?",
          )
          .bind(ctx.userId, game_id, template_name)
          .all<{ contact_email_fp: string; sent_at: string }>();

        const sentMap = new Map(
          history.results.map((r) => [r.contact_email_fp, r.sent_at]),
        );

        const eligible = indexedContacts
          .filter(({ fp }) => !sentMap.has(fp))
          .map(({ contact }) => contact);

        const skipped = indexedContacts
          .filter(({ fp }) => sentMap.has(fp))
          .map(({ contact, fp }) => ({
            ...contact,
            previously_sent_at: sentMap.get(fp) ?? null,
          }));

        return toolSuccess({
          eligible_count: eligible.length,
          skipped_count: skipped.length,
          eligible,
          skipped,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Eligibility check failed");
      }
    },
  );
}
