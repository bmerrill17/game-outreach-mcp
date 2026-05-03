# Game Outreach MCP

A remote [Model Context Protocol](https://modelcontextprotocol.io/) server for indie game media outreach. Built on **Cloudflare Workers + Hono + D1**.

This server is intentionally narrow. It does not send emails, generate copy, or make decisions. It owns the three things an agent genuinely cannot do itself:

- **External data fetching** — Steam pages, YouTube channels, Tavily web search
- **Template persistence** — reusable email templates with placeholder support
- **Send-history state** — per-game, per-template deduplication so the same pitch never goes out twice

All reasoning, hook writing, and orchestration belongs to the agent calling the server.

---

## Architecture

```
Agent (Claude / other MCP client)
  │
  ▼
Hono app on Cloudflare Workers
  │
  ├── /mcp     — MCP Streamable HTTP transport
  └── /health  — uptime check
  │
  ▼
D1 (SQLite at the edge)   ── templates, sent_emails
External APIs             ── Steam Store, YouTube Data API, Tavily
```

Auth is purely **header-based**. There is no OAuth, no sessions, no stored credentials. A stable `userId` is derived by hashing the user's submitted key pair so the same person on different machines gets the same history.

---

## Tools (11 total)

| Category   | Tool                          | Purpose                                                                |
| ---------- | ----------------------------- | ---------------------------------------------------------------------- |
| Research   | `get_steam_page`              | Parse a Steam URL into tags, genres, description, app id              |
| Research   | `find_channels`               | Search YouTube + Tavily for relevant content creator channels         |
| Research   | `get_channel_info`            | Pull recent videos, contact email, subscriber count for a channel     |
| Templates  | `create_template`             | Persist a reusable template with `{{placeholders}}`                   |
| Templates  | `get_template`                | Fetch one template by semantic name                                    |
| Templates  | `list_templates`              | List all templates for the current user                                |
| Templates  | `update_template`             | Patch the subject and/or body of an existing template                  |
| Templates  | `delete_template`             | Remove a template (history rows are preserved)                         |
| Outreach   | `check_contact_eligibility`   | Filter contacts to those not yet sent a given template for a game     |
| Outreach   | `record_send`                 | Append an immutable send-history row                                   |
| Reporting  | `get_outreach_summary`        | Aggregate sends by game and template                                   |

Plus one MCP **prompt**: `outreach-workflow` — the canonical workflow guide, discoverable via `prompts/list`.

---

## Usage

This server is self-documenting via MCP Prompts. Once connected, call `prompts/list` to discover available prompts, then `prompts/get` with name `outreach-workflow` to load the full workflow into your agent's context.

A pre-built skill file is available at [`examples/outreach-workflow.skill.md`](examples/outreach-workflow.skill.md) for agents that benefit from auto-loaded context (e.g. Claude Code). It mirrors the server prompt — the server prompt is the authoritative version.

### Required Headers

Every request must include:

| Header           | Where to get a key                                                              |
| ---------------- | ------------------------------------------------------------------------------- |
| `x-tavily-key`   | Free at [tavily.com](https://tavily.com)                                        |
| `x-youtube-key`  | Free at [Google Cloud Console](https://console.cloud.google.com) (YouTube Data API v3) |

### Auth & Storage

This server **never stores your API keys**. Keys passed via request headers are used for that request only and immediately discarded. You can verify this in [`src/auth.ts`](src/auth.ts) — keys are hashed to derive a stable user ID and never written to any storage.

Your send history and templates are stored in Cloudflare D1, scoped to the hash of your key combination. **If you change your keys your history will not be accessible under the new key pair.**

### What This Server Does Not Do

- **Send emails** — use your own Gmail MCP, Resend MCP, or any email tool
- **Generate personalised copy** — your agent does this
- **Store API keys** — derived hash only
- **Access your game files or Unity project**

---

## Deploy

### Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### 1. Install dependencies

```bash
npm install
```

### 2. Create D1 database

```bash
wrangler d1 create game-outreach-mcp-db
```

Copy the printed `database_id` into `wrangler.toml`.

### 3. Run migrations

Local:
```bash
npm run db:init
```

Remote (production):
```bash
npm run db:init:remote
```

### 4. Type check

```bash
npm run typecheck
```

### 5. Run locally

```bash
npm run dev
```

Test the health endpoint:
```bash
curl http://localhost:8787/health
```

List the 11 tools:
```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-tavily-key: your-tavily-key" \
  -H "x-youtube-key: your-youtube-key" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Discover the workflow prompt:
```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-tavily-key: your-tavily-key" \
  -H "x-youtube-key: your-youtube-key" \
  -d '{"jsonrpc":"2.0","method":"prompts/list","id":2}'
```

### 6. Deploy

```bash
npm run deploy
```

---

## Connect to a client

### Claude Desktop / Claude Code

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "game-outreach": {
      "url": "https://game-outreach-mcp.YOUR_SUBDOMAIN.workers.dev/mcp",
      "transport": "http",
      "headers": {
        "x-tavily-key":  "your-tavily-key",
        "x-youtube-key": "your-youtube-key"
      }
    }
  }
}
```

Restart Claude. The 11 tools and the `outreach-workflow` prompt should appear.

---

## Project Structure

```
game-outreach-mcp/
├── src/
│   ├── index.ts                   # Hono app + MCP HTTP transport wiring
│   ├── server.ts                  # MCP server assembly
│   ├── auth.ts                    # Header extraction + stable userId hashing
│   ├── db.ts                      # D1 typed query helpers
│   ├── tools/
│   │   ├── research/              # get_steam_page, find_channels, get_channel_info
│   │   ├── templates/             # create / get / list / update / delete
│   │   ├── outreach/              # check_contact_eligibility, record_send
│   │   └── reporting/             # get_outreach_summary
│   ├── prompts/
│   │   └── outreach-workflow.ts   # Canonical workflow prompt (source of truth)
│   ├── types/                     # env, tool-context, db row shapes
│   └── lib/                       # steam, youtube, tavily, errors
├── examples/
│   └── outreach-workflow.skill.md # Mirrors the server prompt for skill-aware agents
├── migrations/
│   └── 0001_initial.sql           # D1 schema
├── wrangler.toml
├── tsconfig.json
└── package.json
```

---

## Out-of-scope (intentional)

- Per-user rate limiting (add Cloudflare's built-in rate limiting if abuse becomes a concern)
- Pagination on list endpoints (D1 result sets are small at this scale; add `LIMIT/OFFSET` later)
- Webhook support
- Any email sending (belongs to the user's own tooling)

---

## License

MIT
