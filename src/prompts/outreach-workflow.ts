import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Exported so the examples/outreach-workflow.skill.md can stay in sync.
// When updating this content, update the skill file to match.
export const OUTREACH_WORKFLOW_CONTENT = `# Game Outreach Workflow

## What This Server Does
This server handles the parts of indie game media outreach that require external data or persistent state:
- Fetching structured game data from Steam
- Discovering relevant content creator channels via YouTube and Tavily
- Managing reusable outreach email templates
- Tracking which contacts have received which templates per game
- Recording completed sends for deduplication

The server does NOT send emails, generate hooks, or make decisions.
All reasoning, hook writing, and orchestration belongs to you (the agent).

## Standard Outreach Run

1. Call \`get_steam_page\` with the game's Steam store URL
   → Returns: appId, name, description, tags, genres, developer

2. Call \`list_templates\` to see available templates
   → If none exist, call \`create_template\` first

3. Call \`find_channels\` with game tags and game name
   → Aim for 20-30 candidates; use both youtube and tavily sources
   → Filter mentally: prioritise 5k–200k subscribers for indie games

4. For each shortlisted channel, call \`get_channel_info\`
   → Returns: recent video titles, contact email, subscriber count, country
   → Recent video titles are the primary input for hook generation

5. Call \`check_contact_eligibility\` with your contact list, template name, and game_id
   → Returns eligible (not yet sent) and skipped (already sent) contacts
   → Always do this before sending — never skip deduplication

6. For each eligible contact:
   a. Read their recent video titles from step 4
   b. Write a specific 2–3 sentence hook connecting the game to their content
      — Reference actual video titles by name, not generically
      — Connect one specific game mechanic to what they clearly enjoy covering
      — No superlatives (amazing, incredible, unique)
      — Do not mention competitor games
   c. Call \`get_template\` to retrieve the template body and subject
   d. Substitute {{channel_name}}, {{game_name}}, and {{hook}} yourself
   e. Send via the user's connected email MCP (Gmail, Resend, or other)
   f. Immediately call \`record_send\` on every successful send

7. Call \`get_outreach_summary\` to report campaign coverage

## Template Placeholder Reference

Templates support these placeholders — you substitute them at send time:
- \`{{channel_name}}\` — display name of the YouTube channel
- \`{{game_name}}\` — name of the game as returned by get_steam_page
- \`{{hook}}\` — the personalised connection paragraph you generate per channel

## Deduplication Behaviour

Deduplication is scoped to: contact_email + game_id + template_name

This means:
- The same contact CAN receive different templates for the same game
- The same contact CAN receive the same template for different games
- The same contact will NOT receive the same template for the same game twice

## Email Sending

This server does not send email. Use whichever email MCP the user has connected:
- Gmail MCP → send via connected Google account
- Resend MCP → send via Resend account
- Any other email tool the agent has access to

If no email tool is available or the user does not request sending,
return the rendered draft emails as output for manual review instead.
Call \`record_send\` only after a confirmed successful send.

## game_id Reference

game_id is the Steam numeric app ID extracted from the Steam URL.
Example: https://store.steampowered.com/app/1234567/Game_Name/ → game_id is "1234567"
get_steam_page returns this as the \`appId\` field.
`;

const PromptArgsSchema = {
  game_url: z
    .string()
    .optional()
    .describe(
      "Optional Steam store URL to pre-pin the campaign to a specific game. If provided, the agent should call get_steam_page on this URL as the first step.",
    ),
  template_name: z
    .string()
    .optional()
    .describe(
      "Optional semantic template name to use for this run. If provided, the agent skips template selection and uses this template throughout.",
    ),
  dry_run: z
    .enum(["true", "false"])
    .optional()
    .describe(
      "If 'true', the agent should render draft emails for review and skip the actual send + record_send step. Defaults to 'false'.",
    ),
};

function renderArgsAddendum(args: {
  game_url?: string | undefined;
  template_name?: string | undefined;
  dry_run?: string | undefined;
}): string {
  const lines: string[] = [];
  if (args.game_url) lines.push(`- Use this Steam URL: ${args.game_url}`);
  if (args.template_name) lines.push(`- Use template: ${args.template_name}`);
  if (args.dry_run === "true") {
    lines.push(
      "- Dry run mode: render draft emails for the user to review. Do not send. Do not call record_send.",
    );
  }

  if (lines.length === 0) return "";

  return `\n\n## Run Configuration (from prompt arguments)\n\n${lines.join("\n")}\n`;
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "outreach-workflow",
    {
      title: "Outreach Workflow",
      description:
        "Complete workflow instructions for running an indie game media outreach campaign using this server. Read this before starting any outreach run. Optional arguments pre-pin the run to a specific game, template, or dry-run mode.",
      argsSchema: PromptArgsSchema,
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: OUTREACH_WORKFLOW_CONTENT + renderArgsAddendum(args),
          },
        },
      ],
    }),
  );
}
