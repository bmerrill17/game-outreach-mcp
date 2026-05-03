import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/tool-context";
import { fetchSteamPage } from "../../lib/steam";
import { toolError, toolSuccess } from "../../lib/errors";

export const GetSteamPageSchema = {
  url: z
    .string()
    .url()
    .describe(
      "Full Steam store URL e.g. https://store.steampowered.com/app/1234567/Game_Name/",
    ),
};

export function registerGetSteamPage(server: McpServer, getCtx: () => ToolContext): void {
  server.tool(
    "get_steam_page",
    "Fetches and parses a Steam store page returning structured game data including tags, genres, description and developer. Use this as the first step in any outreach workflow to extract the game context needed for channel matching.",
    GetSteamPageSchema,
    async ({ url }) => {
      // getCtx is called for parity with other tools — Steam API needs no per-user key
      void getCtx;
      try {
        const data = await fetchSteamPage(url);
        return toolSuccess(data);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to fetch Steam page");
      }
    },
  );
}
