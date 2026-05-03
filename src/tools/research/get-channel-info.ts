import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { getYouTubeChannelDetail } from "../../lib/youtube";
import { toolError, toolSuccess } from "../../lib/errors";

export const GetChannelInfoSchema = {
  channel_url: z
    .string()
    .url()
    .describe(
      "YouTube channel URL — supports /channel/UC..., /@handle, /c/name, and /user/name formats",
    ),
};

export function registerGetChannelInfo(server: McpServer, getCtx: () => ToolContext): void {
  server.tool(
    "get_channel_info",
    "Fetches detailed information about a specific YouTube channel including recent video titles, contact email extracted from channel description, subscriber count, and country. Recent video titles are the primary input for hook generation — use this before drafting any outreach for a channel.",
    GetChannelInfoSchema,
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
