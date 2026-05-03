# Game Outreach MCP

A remote [Model Context Protocol](https://modelcontextprotocol.io/) server for indie game media outreach. Built on **Cloudflare Workers + Hono + D1**.

This server is intentionally narrow. It does not send emails, generate copy, or make decisions. It owns the three things an agent genuinely cannot do itself:

- **External data fetching** — Steam pages, YouTube channels, Tavily web search
- **Template persistence** — reusable email templates with placeholder support
- **Send-history state** — per-game, per-template deduplication so the same pitch never goes out twice

All reasoning, hook writing, and orchestration belongs to the agent calling the server.

---

## Two ways to use this

| Mode                              | Setup    | Who owns the data                                   | Use it for                                    |
| --------------------------------- | -------- | --------------------------------------------------- | --------------------------------------------- |
| **Hosted demo** *(try-it only)*   | 0 min    | The maintainer holds your templates + send history  | Kicking the tires, exploring the tools        |
| **Self-host** *(production path)* | ~10 min  | You. Your Cloudflare account, your D1.              | Anything you'd actually be sad to lose        |

> **Use self-host for anything real.** The hosted instance is a personal demo deployment. It has no SLA, no backups guaranteed beyond Cloudflare defaults, no migration plan if I take it down, and no way for the maintainer to recover your data if you lose access. If you're running a real campaign with real contacts — fork and deploy. The self-host path is exactly the same code, takes about 10 minutes, and costs $0 on Cloudflare's free tier. See [Option B](#option-b--self-host).

---

## Option A — Use the hosted instance

> ⚠️ **Demo only — not for production use.** Read the [fragility notes](#how-auth-works-on-the-hosted-instance) below before relying on this for anything you can't afford to lose. For real campaigns, [self-host](#option-b--self-host).

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

### How auth works on the hosted instance

There is no signup, no email, no password. The hosted instance derives a stable per-user partition key by SHA-256 hashing your `(tavily_key, youtube_key)` pair on each request. **Your two API keys are functionally your account.** Verifiable in [`src/auth.ts`](src/auth.ts).

This is fine for a demo, but it has hard fragility properties you must understand before storing anything you care about:

- **No recovery.** Lose either API key and your templates + send history are unreachable. The maintainer holds only the hash and cannot help you recover. The data isn't deleted, just orphaned.
- **Key rotation orphans your data.** Rotating your Tavily or YouTube key creates a new partition. Migrating from old → new requires you to copy templates by hand *before* you rotate.
- **Sharing keys = sharing data.** Anyone you give your two API keys to becomes the same user from the server's perspective. There are no per-user roles, ACLs, or audit trails.
- **No SLA, no backups guaranteed.** This is a personal Worker on a free tier. The maintainer may turn it off, change deployment, or hit a free-tier limit at any time.
- **The hash is not the keys, but it is a key-derived fingerprint.** SHA-256 is one-way and the input space is too large to brute-force, so an attacker who steals the database cannot recover your API keys from it. They could, however, *correlate* your row to your keys if they obtained those keys from a different source.

### What the maintainer sees vs. doesn't

| Visible to maintainer                                                  | Not visible                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Hash of your two API keys (32 hex chars), used as your partition key   | Your Tavily / YouTube API keys themselves                |
| Templates you create (subject + body)                                  | Anything happening inside your MCP client                |
| Send history rows: contact email, channel URL, game ID, template name  | The actual emails you send (this server doesn't send mail) |
| Worker request logs (Cloudflare default), with sensitive headers stripped before any custom log line | Plaintext credentials in any form                        |

If any of the fragility points above are deal-breakers — and for a real outreach campaign, they should be — **[self-host](#option-b--self-host)**.

---

## Option B — Self-host

**This is the production path.** The whole project deploys to your own Cloudflare account in about 10 minutes. You own the D1 database, you own the Worker, the maintainer sees nothing, the fragility tradeoffs above stop being yours to inherit. Cost: $0 on Cloudflare's free tier for typical indie usage.

You'll need: a [Cloudflare account](https://dash.cloudflare.com/sign-up) (free), Node.js 18+, and the two API keys from Option A step 1.

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

Same JSON snippet as Option A, but pointing at *your* Worker URL:

```json
{
  "mcpServers": {
    "game-outreach": {
      "url": "https://my-game-outreach-mcp.<your-subdomain>.workers.dev/mcp",
      "transport": "http",
      "headers": {
        "x-tavily-key":  "your-tavily-key",
        "x-youtube-key": "your-youtube-key"
      }
    }
  }
}
```

Or via Claude Code:

```bash
claude mcp add game-outreach --scope user --transport http \
  https://my-game-outreach-mcp.<your-subdomain>.workers.dev/mcp \
  --header "x-tavily-key: your-tavily-key" \
  --header "x-youtube-key: your-youtube-key"
```

### 7. (Recommended) Back up your D1 occasionally

Self-hosting puts you in control, which means you also own the recovery story. D1 has its own time-travel restore for accidents, but for outreach campaigns you care about it's worth periodically exporting:

```bash
npx wrangler d1 export game-outreach-mcp-db --remote --output=backup.sql
```

Self-hosting doesn't *eliminate* the key-derived userId model — that's a code-level design decision and applies anywhere this code runs. What it does eliminate is the "the maintainer holds my data and I can't get it back" risk. Your data lives in *your* D1, you can `wrangler d1 execute "SELECT *"` it any time, and key rotations are recoverable because you can manually re-key rows (or just fork the code to use any auth model you prefer).

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
