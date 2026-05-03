import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { fetchSteamPage } from "../../lib/steam";
import { toolError, toolSuccess } from "../../lib/errors";

const InputSchema = {
  url: z
    .string()
    .url()
    .describe(
      "Full Steam store URL e.g. https://store.steampowered.com/app/1234567/Game_Name/",
    ),
};

const OutputSchema = {
  appId: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  genres: z.array(z.string()),
  developer: z.string(),
  releaseDate: z.string(),
  reviewScore: z.string().nullable(),
};

export function registerGetSteamPage(server: McpServer, _getCtx: () => ToolContext): void {
  server.registerTool(
    "get_steam_page",
    {
      title: "Get Steam Page",
      description:
        "Fetches and parses a Steam store page returning structured game data including tags, genres, description and developer. Use this as the first step in any outreach workflow to extract the game context needed for channel matching.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url }) => {
      try {
        const data = await fetchSteamPage(url);
        return toolSuccess(data);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to fetch Steam page");
      }
    },
  );
}
