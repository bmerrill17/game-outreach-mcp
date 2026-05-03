import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { getYouTubeChannelDetail } from "../../lib/youtube";
import { toolError, toolSuccess } from "../../lib/errors";

const InputSchema = {
  channel_url: z
    .string()
    .url()
    .describe(
      "YouTube channel URL — supports /channel/UC..., /@handle, /c/name, and /user/name formats",
    ),
};

const RecentVideoSchema = z.object({
  title: z.string(),
  publishedAt: z.string(),
  url: z.string(),
});

const OutputSchema = {
  channelId: z.string(),
  name: z.string(),
  url: z.string(),
  description: z.string(),
  subscribers: z.number().nullable(),
  country: z.string().nullable(),
  customUrl: z.string().nullable(),
  contactEmail: z.string().nullable(),
  recentVideos: z.array(RecentVideoSchema),
};

export function registerGetChannelInfo(server: McpServer, getCtx: () => ToolContext): void {
  server.registerTool(
    "get_channel_info",
    {
      title: "Get Channel Info",
      description:
        "Fetches detailed information about a specific YouTube channel including recent video titles, contact email extracted from channel description, subscriber count, and country. Recent video titles are the primary input for hook generation — use this before drafting any outreach for a channel.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channel_url }) => {
      const ctx = getCtx();
      try {
        const detail = await getYouTubeChannelDetail(channel_url, ctx.youtubeKey);
        return toolSuccess(detail);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to fetch channel info");
      }
    },
  );
}
