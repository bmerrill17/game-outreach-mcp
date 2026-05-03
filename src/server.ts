import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./types/tool-context";

import { registerGetSteamPage } from "./tools/research/get-steam-page";
import { registerFindChannels } from "./tools/research/find-channels";
import { registerGetChannelInfo } from "./tools/research/get-channel-info";

import { registerCreateTemplate } from "./tools/templates/create-template";
import { registerGetTemplate } from "./tools/templates/get-template";
import { registerListTemplates } from "./tools/templates/list-templates";
import { registerUpdateTemplate } from "./tools/templates/update-template";
import { registerDeleteTemplate } from "./tools/templates/delete-template";

import { registerCheckContactEligibility } from "./tools/outreach/check-contact-eligibility";
import { registerRecordSend } from "./tools/outreach/record-send";

import { registerGetOutreachSummary } from "./tools/reporting/get-outreach-summary";

import { registerTemplateResources } from "./resources/templates";

import { registerPrompts } from "./prompts/outreach-workflow";

export const SERVER_INFO = {
  name: "game-outreach-mcp",
  version: "1.0.0",
} as const;

export function createMcpServer(getCtx: () => ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO);

  // Research
  registerGetSteamPage(server, getCtx);
  registerFindChannels(server, getCtx);
  registerGetChannelInfo(server, getCtx);

  // Templates
  registerCreateTemplate(server, getCtx);
  registerGetTemplate(server, getCtx);
  registerListTemplates(server, getCtx);
  registerUpdateTemplate(server, getCtx);
  registerDeleteTemplate(server, getCtx);

  // Outreach
  registerCheckContactEligibility(server, getCtx);
  registerRecordSend(server, getCtx);

  // Reporting
  registerGetOutreachSummary(server, getCtx);

  // Resources — templates surfaced as first-class readable state alongside the CRUD tools
  registerTemplateResources(server, getCtx);

  // Prompts — canonical workflow instructions, discoverable by any MCP client
  registerPrompts(server);

  return server;
}
