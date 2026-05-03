# Game Outreach MCP

A remote [Model Context Protocol](https://modelcontextprotocol.io/) server for indie game media outreach. Built on **Cloudflare Workers + Hono + D1**.

This server is intentionally narrow. It does not send emails, generate copy, or make decisions. It owns the three things an agent genuinely cannot do itself:

- **External data fetching** — Steam pages, YouTube channels, Tavily web search
- **Template persistence** — reusable email templates with placeholder support
- **Send-history state** — per-game, per-template deduplication so the same pitch never goes out twice

All reasoning, hook writing, and orchestration belongs to the agent calling the server.

---

## Two ways to use this

| Mode             | Setup time | Who hosts      | Who owns the data                          | Cost to you |
| ---------------- | ---------- | -------------- | ------------------------------------------ | ----------- |
| **Hosted demo**  | 0 minutes  | The maintainer | The maintainer holds your templates + send history (key-hash partitioned) | Free        |
| **Self-host**    | ~10 min    | You            | You. Your Cloudflare account, your D1.     | Free tier   |

If you're trying it out or running a small campaign, the hosted demo is the lowest-friction path. If you're running serious outreach, treating contact data as sensitive, or want zero trust dependencies — **self-host**. Same code, same Worker, just a different deploy target.

---

## Option A — Use the hosted instance

### 1. Get two free API keys

| Key            | Where                                                                            |
| -------------- | -------------------------------------------------------------------------------- |
| `x-tavily-key` | [tavily.com](https://tavily.com)                                                 |
| `x-youtube-key`| [console.cloud.google.com](https://console.cloud.google.com) → enable YouTube Data API v3 |

### 2. Add to your MCP client

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "game-outreach": {
      "url": "https://game-outreach-mcp.bmerrill17.workers.dev/mcp",
      "transport": "http",
      "headers": {
        "x-tavily-key":  "your-tavily-key",
        "x-youtube-key": "your-youtube-key"
      }
    }
  }
}
```

Restart your client. The 11 tools and the `outreach-workflow` prompt will appear.

### What the maintainer sees vs. doesn't

The auth model is **header-based with no key storage**. Verifiable in [`src/auth.ts`](src/auth.ts):

| Visible to maintainer                                                  | Not visible                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Hash of your two API keys (32 hex chars), used as your partition key   | Your Tavily / YouTube API keys themselves                |
| Templates you create (subject + body)                                  | Anything happening inside your MCP client                |
| Send history rows: contact email, channel URL, game ID, template name  | The actual emails you send (this server doesn't send mail) |
| Worker request logs (Cloudflare default), with sensitive headers stripped before any custom log line | Plaintext credentials in any form                        |

If "the maintainer holds my list of pitched contacts" is not OK with you, **self-host**.

---

## Option B — Self-host

The whole project deploys to your own Cloudflare account in a few minutes. You own the D1 database, you own the Worker, the maintainer sees nothing.

### 1. Install wrangler and authenticate

```bash
npm install
npx wrangler login
```

### 2. Pick your own names

Edit [`wrangler.toml`](wrangler.toml) — change `name`, `database_name`, and (after the next step) `database_id`:

```toml
name = "my-game-outreach-mcp"        # your worker name
[[d1_databases]]
binding       = "DB"
database_name = "my-game-outreach-db"  # your DB name
database_id   = "..."                  # filled in after step 3
```

If you renamed `database_name`, also update the matching name in [`package.json`](package.json) → `scripts.db:init` and `scripts.db:init:remote`.

### 3. Create your D1 database

```bash
npx wrangler d1 create my-game-outreach-db
```

Copy the printed `database_id` into `wrangler.toml`.

### 4. Apply the schema

Local (for `npm run dev`):
```bash
npm run db:init
```

Remote (production):
```bash
npm run db:init:remote
```

### 5. Deploy

```bash
npm run deploy
```

Wrangler will prompt you to pick a `workers.dev` subdomain on first deploy — this is account-wide, set once, used by every Worker you ever publish.

Your URL: `https://my-game-outreach-mcp.<your-subdomain>.workers.dev/mcp`

### 6. Connect your client

Same JSON snippet as Option A, but pointing at *your* Worker URL.

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

## Discovery

This server is self-documenting via MCP Prompts. Once connected, call `prompts/list` to see available prompts, then `prompts/get` with name `outreach-workflow` to load the full workflow into your agent's context.

A pre-built skill file is also at [`examples/outreach-workflow.skill.md`](examples/outreach-workflow.skill.md) for agents that benefit from auto-loaded context (e.g. Claude Code). It mirrors the server prompt — the server prompt is the authoritative version.

---

## Architecture

```
Agent (Claude / other MCP client)
  │
  ▼
Hono app on Cloudflare Workers
  │
  ├── /mcp     — MCP Streamable HTTP transport (Web Standard APIs)
  └── /health  — uptime check
  │
  ▼
D1 (SQLite at the edge)   ── templates, sent_emails
External APIs             ── Steam Store, YouTube Data API, Tavily
```

The Worker uses the SDK's `WebStandardStreamableHTTPServerTransport`, which speaks the MCP Streamable HTTP spec natively over `Request`/`Response` — no Node compat shims. Each request constructs a fresh server + transport in stateless mode, so there is no cross-request state on the edge.

A stable per-user `userId` is derived by SHA-256 hashing the user's `(tavily_key, youtube_key)` pair. The same person on different machines with the same keys gets the same history. **Changing keys creates a new partition** — old history is unreachable, not deleted.

---

## Project structure

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

## Local development

```bash
npm install
npm run db:init       # local D1
npm run dev           # http://localhost:8787
npm run typecheck
```

Smoke test the MCP endpoint:

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-tavily-key: your-tavily-key" \
  -H "x-youtube-key: your-youtube-key" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

## What this server does **not** do

- **Send emails** — use your Gmail MCP, Resend MCP, or any other email tool
- **Generate personalised copy** — the agent does this
- **Store API keys** — only a non-reversible hash
- **Access your game files or engine project**

---

## Out-of-scope (intentional)

- Per-user rate limiting (add Cloudflare's built-in rate limiting if abuse becomes a concern)
- Pagination on list endpoints (D1 result sets are small at this scale; add `LIMIT/OFFSET` later)
- Webhook support
- Any email sending (belongs to the user's own tooling)

---

## License

MIT
