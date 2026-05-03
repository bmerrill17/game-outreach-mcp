import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { searchYouTubeChannels, type YouTubeChannelShallow } from "../../lib/youtube";
import { tavilySearch, type TavilySearchResult } from "../../lib/tavily";
import { toolError, toolSuccess } from "../../lib/errors";

export const FindChannelsSchema = {
  tags: z
    .array(z.string())
    .min(1)
    .describe(
      "Game tags or genres from Steam page e.g. ['tactics', 'strategy', 'indie', 'turn-based']",
    ),
  game_name: z.string().describe("Name of the game — used to refine search queries"),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum number of channels to return across all sources"),
  sources: z
    .array(z.enum(["youtube", "tavily"]))
    .default(["youtube", "tavily"])
    .describe(
      "Which sources to search. YouTube finds channels directly. Tavily finds coverage across blogs and smaller sites.",
    ),
};

type FoundChannel =
  | (YouTubeChannelShallow & { source: "youtube" })
  | (TavilySearchResult & { source: "tavily" });

export function registerFindChannels(server: McpServer, getCtx: () => ToolContext): void {
  server.tool(
    "find_channels",
    "Searches for content creator channels relevant to a game based on its tags. Returns shallow channel data suitable for deciding which channels warrant a deeper look via get_channel_info. Searches YouTube directly and optionally broader web via Tavily.",
    FindChannelsSchema,
    async ({ tags, game_name, max_results, sources }) => {
      const ctx = getCtx();

      try {
        const query = `${game_name} ${tags.slice(0, 4).join(" ")} game review coverage`;
        const perSource = Math.max(1, Math.ceil(max_results / sources.length));
        const results: FoundChannel[] = [];

        if (sources.includes("youtube")) {
          const yt = await searchYouTubeChannels(query, ctx.youtubeKey, perSource);
          results.push(...yt.map((r) => ({ ...r, source: "youtube" as const })));
        }

        if (sources.includes("tavily")) {
          const tv = await tavilySearch(
            `${query} youtube channel site:youtube.com`,
            ctx.tavilyKey,
            perSource,
          );
          results.push(...tv.map((r) => ({ ...r, source: "tavily" as const })));
        }

        return toolSuccess({ count: results.length, channels: results });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Channel search failed");
      }
    },
  );
}
