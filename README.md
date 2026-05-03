# Game Outreach MCP

A remote [Model Context Protocol](https://modelcontextprotocol.io/) server for indie game media outreach. Built on **Cloudflare Workers + Hono + D1**. Targets MCP protocol version `2025-06-18`.

This server is intentionally narrow. It does not send emails, generate copy, or make decisions. It owns the three things an agent genuinely cannot do itself:

- **External data fetching** — Steam pages, YouTube channels, Tavily web search
- **Template persistence** — reusable email templates with placeholder support
- **Send-history state** — per-game, per-template deduplication so the same pitch never goes out twice

All reasoning, hook writing, and orchestration belongs to the agent calling the server.

### What kind of MCP this is

Most MCP servers are *thin wrappers* over an existing service — Slack, Linear, Postgres, GitHub. They translate one external API into MCP shape and call it a day.

This server is a **domain-specific orchestration layer with its own state**. It composes three external APIs (Steam, YouTube, Tavily), holds two of its own tables (templates, send-history), exposes those tables as both *tools* and *resources*, and ships a *prompt* that teaches the agent how to use them together. That makes it useful as a reference for what a non-trivial MCP server looks like — not "wrap this API," but "design a tool surface and a small persistent layer for a specific workflow, and let the agent reason on top."

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

You need a Tavily key and a YouTube Data API key. Both are free, no credit card required, and they're the same keys whether you use the hosted demo or self-host — so do this once.

#### Tavily (~1 minute)

1. Go to [tavily.com](https://tavily.com) and sign up
2. Verify your email — the dashboard opens with your key already generated
3. Copy it. The format is `tvly-...`

Free tier: 1,000 searches/month. More than enough for indie outreach.

#### YouTube Data API v3 (~5 minutes)

1. Open [console.cloud.google.com](https://console.cloud.google.com) and sign in with any Google account
2. Top bar → project dropdown → **New Project** → name it (e.g. `outreach-mcp`) → **Create**
3. With the new project selected: hamburger menu → **APIs & Services** → **Library**
4. Search **"YouTube Data API v3"** → click it → **Enable**
5. Left sidebar → **Credentials** → **+ Create Credentials** → **API key**
6. Copy the key. The format is `AIzaSy...`
7. (Recommended) Click **Edit API key** → under "API restrictions" select **Restrict key** → check only "YouTube Data API v3" → **Save**. The key becomes useless for any other Google API if it leaks.

Free tier: 10,000 units/day. A channel search costs ~100 units; fetching channel details costs ~1 unit. Plenty of headroom.

### 2. Register the MCP with your client

Pick whichever client you use. Same hosted URL either way, both store the keys in plaintext in a local config file.

#### Claude Code (CLI)

One command:

```bash
claude mcp add game-outreach --scope user --transport http \
  https://game-outreach-mcp.bmerrill17.workers.dev/mcp \
  --header "x-tavily-key: tvly-PASTE_YOURS" \
  --header "x-youtube-key: AIzaSy-PASTE_YOURS"
```

Verify:
- `claude mcp list` — should show `game-outreach`
- In any session, type `/mcp` — shows connection status and the 12 tools

`--scope user` writes to `~/.claude.json` and makes the server available in every Claude Code session on this machine. Use `--scope project` instead to write to `.mcp.json` in the current repo (don't do that if your headers contain real keys you don't want in git).

#### Claude Desktop (the app)

1. Open the config file (create it if it doesn't exist):

   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

2. Paste this, replacing the key values:

   ```json
   {
     "mcpServers": {
       "game-outreach": {
         "url": "https://game-outreach-mcp.bmerrill17.workers.dev/mcp",
         "transport": "http",
         "headers": {
           "x-tavily-key":  "tvly-PASTE_YOURS",
           "x-youtube-key": "AIzaSy-PASTE_YOURS"
         }
       }
     }
   }
   ```

3. **Fully quit and restart** Claude Desktop (tray icon → Quit, not just close the window). The 11 tools and the `outreach-workflow` prompt will appear in the tools menu.

### 3. Smoke test

Ask the agent: *"List my outreach templates"*. If it picks the `list_templates` tool and returns `count: 0` (assuming you haven't created any yet), the connection is working end-to-end.

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
| Templates you create (subject + body) — *not encrypted*               | Your encrypted PII (see below)                           |
| Send history metadata: `game_id`, `template_name`, `sent_at`, `sent_via` | `contact_email`, `channel_url`, `channel_name`, `notes` — **AES-GCM ciphertext** under a key derived per-request from your API headers. Maintainer cannot decrypt. |
| HMAC fingerprints of contact emails (used for dedup) — opaque hex      | The plaintext emails behind those fingerprints           |
| Worker request logs (Cloudflare default), with sensitive headers stripped before any custom log line | Plaintext credentials in any form                        |

PII fields are encrypted at rest under per-user keys derived from your API headers. The maintainer holds opaque ciphertext that cannot be decrypted with database access alone — see [Design decisions → PII encrypted at rest](#pii-encrypted-at-rest-under-per-user-keys) for the full crypto model.

That said, the *templates themselves* (subject + body text) are not encrypted, and the fragility properties above (no recovery, no SLA, etc.) still apply. If any of those are deal-breakers — and for a real outreach campaign, they should be — **[self-host](#option-b--self-host)**.

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

Migrations are applied with `wrangler d1 migrations apply`, which tracks which files have run and only applies new ones.

Local (for `npm run dev`):
```bash
npm run db:migrate
```

Remote (production):
```bash
npm run db:migrate:remote
```

### 5. Deploy

```bash
npm run deploy
```

Wrangler will prompt you to pick a `workers.dev` subdomain on first deploy — this is account-wide, set once, used by every Worker you ever publish.

Your URL: `https://my-game-outreach-mcp.<your-subdomain>.workers.dev/mcp`

### 6. Connect your client

Follow [Option A → step 2](#2-register-the-mcp-with-your-client) verbatim, swapping the URL for your own:

```
https://my-game-outreach-mcp.<your-subdomain>.workers.dev/mcp
```

Same Claude Code command, same Claude Desktop JSON, same headers. The only thing that changes is the host.

### 7. (Recommended) Back up your D1 occasionally

Self-hosting puts you in control, which means you also own the recovery story. D1 has its own time-travel restore for accidents, but for outreach campaigns you care about it's worth periodically exporting:

```bash
npx wrangler d1 export game-outreach-mcp-db --remote --output=backup.sql
```

Self-hosting doesn't *eliminate* the key-derived userId model — that's a code-level design decision and applies anywhere this code runs. What it does eliminate is the "the maintainer holds my data and I can't get it back" risk. Your data lives in *your* D1, you can `wrangler d1 execute "SELECT *"` it any time, and key rotations are recoverable because you can manually re-key rows (or just fork the code to use any auth model you prefer).

---

## Surface area

### Tools (12)

Every tool ships with `inputSchema`, `outputSchema`, behavioral `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), and returns both `content` (text) and `structuredContent` (typed object) so modern clients get parseable data while older ones still see formatted text.

| Category   | Tool                          | Purpose                                                                |
| ---------- | ----------------------------- | ---------------------------------------------------------------------- |
| Research   | `get_steam_page`              | Parse a Steam URL into tags, genres, description, app id              |
| Research   | `find_channels`               | Search YouTube + Tavily for relevant content creator channels (emits progress notifications) |
| Research   | `get_channel_info`            | Pull recent videos, contact email, subscriber count for a channel     |
| Templates  | `create_template`             | Persist a reusable template with `{{placeholders}}`                   |
| Templates  | `get_template`                | Fetch one template by semantic name                                    |
| Templates  | `list_templates`              | List templates for the current user (paginated)                       |
| Templates  | `update_template`             | Patch the subject and/or body of an existing template                  |
| Templates  | `delete_template`             | Remove a template (history rows are preserved)                         |
| Outreach   | `check_contact_eligibility`   | Filter contacts to those not yet sent a given template for a game     |
| Outreach   | `record_send`                 | Append an immutable send-history row                                   |
| Reporting  | `get_outreach_summary`        | Aggregate sends by game and template (paginated)                      |
| Reporting  | `list_sent_contacts`          | Distinct contacts pitched for a game with channel info + templates sent — drives follow-up campaigns (paginated) |

### Resources (1)

| URI template          | Purpose                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `template://{name}`   | Each saved template surfaced as a readable resource. Supports `list` and name autocomplete. |

Templates appear as resources *in addition to* the CRUD tools. Tools are for *actions*; resources are for *readable state the agent may want to enumerate as context*. Modeling templates both ways lets resource-aware clients (e.g. an "@-mention" picker) treat them as first-class context without losing the imperative tool API.

### Prompts (1)

| Name                  | Arguments                                  | Purpose                                       |
| --------------------- | ------------------------------------------ | --------------------------------------------- |
| `outreach-workflow`   | `game_url?`, `template_name?`, `dry_run?`  | Canonical step-by-step workflow guide. Args optionally pre-pin the run. |

---

## Discovery

This server is self-documenting via MCP Prompts. Once connected, call `prompts/list` to see available prompts, then `prompts/get` with name `outreach-workflow` to load the full workflow into your agent's context.

A pre-built skill file is also at [`examples/outreach-workflow.skill.md`](examples/outreach-workflow.skill.md) for agents that benefit from auto-loaded context (e.g. Claude Code). It mirrors the server prompt — the server prompt is the authoritative version.

---

## Example session

A condensed transcript of what an actual outreach run looks like through this server:

```
user> Help me reach out to YouTubers for my game at
      https://store.steampowered.com/app/1234567/My_Tactical_Roguelike/

agent> [calls prompts/get name=outreach-workflow game_url=...]
       [calls get_steam_page url=...]
        → { appId: "1234567", name: "My Tactical Roguelike",
            tags: ["Tactical","Roguelike","Turn-Based","Indie"], ... }

       [calls list_templates]
        → { count: 1, templates: [{ name: "initial-outreach", ... }] }

       [calls find_channels game_name="My Tactical Roguelike"
                            tags=["Tactical","Roguelike","Turn-Based"]
                            sources=["youtube","tavily"]]
        → progress: "Searching YouTube channels…" (1/2)
        → progress: "YouTube returned 10 channels"
        → progress: "Searching Tavily…" (2/2)
        → { count: 18, channels: [...] }

       [calls get_channel_info channel_url=...] × 4 (shortlist)
        → for each: { name, subscribers, contactEmail, recentVideos: [...] }

       [calls check_contact_eligibility template_name="initial-outreach"
                                        game_id="1234567"
                                        contacts=[...]]
        → { eligible_count: 3, skipped_count: 1, eligible: [...], skipped: [...] }

       [for each eligible contact:
          1. drafts a 2-3 sentence hook referencing actual recent video titles
          2. calls get_template name="initial-outreach"
          3. substitutes {{channel_name}}, {{game_name}}, {{hook}} locally
          4. sends via the user's Gmail/Resend MCP
          5. calls record_send contact_email=... game_id=... template_name=...]

       [calls get_outreach_summary game_id="1234567"]
        → { total_records: 1, summary: [{ template_name: "initial-outreach",
            total_sends: 3, unique_contacts: 3, last_sent_at: "..." }] }

       Done. Sent 3 personalised emails, skipped 1 (already contacted last week).
```

A follow-up run a week later, with a new template, looks like:

```
user> Send the 7-day follow-up template to everyone I pitched for app 1234567.

agent> [calls list_sent_contacts game_id="1234567"]
        → { count: 3, contacts: [
            { contact_email: "...", channel_name: "...",
              templates_sent: ["initial-outreach"], last_sent_at: "..." },
            ... ] }

       [calls check_contact_eligibility template_name="follow-up-7day"
                                        game_id="1234567"
                                        contacts=[...above...]]
        → { eligible_count: 3, skipped_count: 0, ... }

       [for each: get_template "follow-up-7day", substitute, send, record_send]

       Done. Sent 3 follow-ups.
```

The agent does all reasoning and copy generation. The server only fetches data, holds state, and enforces dedupe.

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

The Worker uses the SDK's `WebStandardStreamableHTTPServerTransport`, which speaks the MCP Streamable HTTP spec natively over `Request`/`Response` — no Node compat shims, no `fetch-to-node` adapter. Each request constructs a fresh `McpServer` + transport in stateless mode (no `sessionIdGenerator`), so there is zero cross-request state on the edge. The Worker can be invalidated, scaled, or relocated freely.

A stable per-user `userId` is derived by SHA-256 hashing the user's `(tavily_key, youtube_key)` pair. The same person on different machines with the same keys gets the same history. **Changing keys creates a new partition** — old history is unreachable, not deleted.

---

## Design decisions

The shape of this server is the result of explicit trade-offs. They are documented here because they're the most useful thing for someone reading this as a reference for how to structure their own MCP.

### Data + state, not actions

The server does not send email, generate copy, or orchestrate. The agent does all of that. The server only owns: external data fetching (which the agent cannot do without credentials), template persistence (which needs to outlive a session), and dedupe state (which needs a shared writeable record).

This is the *narrow waist* principle. The server has the smallest tool surface that still removes work the agent genuinely can't do alone. Everything else stays composable: any email tool can sit downstream, any template-rendering style can sit upstream.

### Header-based auth instead of OAuth

OAuth requires a multi-step flow, browser handoff, and token storage. For a *demo / personal* MCP server it's the wrong shape — it adds a ceremony that doubles the setup time and forces the server to either keep credentials or run a callback flow.

Instead, the user passes their own third-party API keys per request via headers (`x-tavily-key`, `x-youtube-key`). Auth is purely "do you hold these two keys?" — and the userId is derived from a SHA-256 hash of the pair so the same user gets the same partition without ever giving us a password. Trade-off accepted: keys-as-account, no recovery if you lose them. See [Option A → How auth works](#how-auth-works-on-the-hosted-instance).

### D1 over KV or Durable Objects

Templates and send-history are naturally relational, queries want `GROUP BY` and indexed lookups, and the data is small. D1 is one binding line in `wrangler.toml`, has a generous free tier, and uses plain SQL. KV would force key-encoded scanning; Durable Objects would buy us per-user isolation we don't yet need at the cost of a much heavier deployment model.

### Per-request stateless transport

Workers isolates can be created and discarded freely. Anything that lives across requests has to be either pushed into a binding (KV, D1, DO) or rebuilt every invocation. We chose the simpler path: the `McpServer` and `Transport` are constructed inside each request handler. Cost: some object construction overhead per request (negligible). Benefit: zero state-management code, no shared mutability, no isolate-affinity bugs.

### Streamable HTTP over stdio / SSE

stdio is a local-process transport — wrong shape for a remote server. The legacy SSE transport was deprecated in favor of Streamable HTTP for remote servers in the [2025-03-26 spec revision](https://modelcontextprotocol.io/). Streamable HTTP supports both JSON-RPC over HTTP POST and SSE-framed responses on the same endpoint, plus per-request progress notifications, and the SDK's `WebStandardStreamableHTTPServerTransport` is built specifically for runtimes like Workers.

### Both a server prompt AND a skill file

`src/prompts/outreach-workflow.ts` registers an MCP prompt — the canonical, discoverable, server-side workflow doc. `examples/outreach-workflow.skill.md` is the *same content* as a Claude Code-compatible skill file. Why both?

- The MCP prompt is the source of truth and works for any MCP client via `prompts/get`.
- The skill file lets agents that auto-load context at session start (Claude Code) absorb the workflow without a `prompts/get` round-trip.

The string content is exported as `OUTREACH_WORKFLOW_CONTENT` from the prompt module specifically so the two can be diffed when one updates.

### Templates are *both* tools and resources

Templates have CRUD tools (`create`, `get`, `list`, `update`, `delete`) *and* are exposed as MCP resources at `template://{name}`. A purist might pick one. We pick both because they answer different client questions: tools are for "perform this action," resources are for "what readable context exists?" Resource-aware clients can show templates in a picker without invoking a tool; tool-only clients can still manage them imperatively.

### Pagination is opaque-cursor, not offset

`list_templates`, `get_outreach_summary`, and `list_sent_contacts` return a `nextCursor` (base64-encoded offset) rather than exposing raw offsets. Today the cursor is just an offset; tomorrow it could become a keyset/seek cursor without breaking callers. The opaqueness is the contract.

### PII encrypted at rest under per-user keys

Third-party contact data (`contact_email`, `channel_url`, `channel_name`, `notes`) lives in D1 as ciphertext, not plaintext. The encryption key is **derived per-request** from the user's `(x-tavily-key, x-youtube-key)` pair via HKDF-SHA256, never stored, and never leaves the request handler.

Concretely, each `sent_emails` row stores:

- `contact_email_fp` — HMAC-SHA256 fingerprint of `lowercase(trim(email))`. Deterministic per-user, used for dedup matching in SQL.
- `contact_email_ct` — AES-GCM ciphertext (random nonce per encryption). Used for retrieval in `list_sent_contacts` (decrypted in the request handler before returning to the agent).
- `channel_url_ct`, `channel_name_ct`, `notes_ct` — same AES-GCM scheme.

Public fields (`game_id`, `template_name`, `sent_at`, `sent_via`) stay in the clear — they're either user-chosen identifiers or non-PII metadata.

Properties:

- A maintainer with D1 access alone reads only opaque hex fingerprints and base64 ciphertext blobs. Decryption requires the user's API keys, which the server doesn't store.
- HMAC keys derive from each user's own API pair, so the same contact email produces different fingerprints across users. No correlation across the user partition boundary.
- A user who loses their API keys can never recover their encrypted history. Same property as `userId`, so consistent.
- Crypto cost per request is negligible — one HKDF derivation, one AES-GCM op per encrypted field, one HMAC per fingerprint.

### What we deliberately did *not* do

- **No OAuth or multi-tenant accounts** — the demo trade-off above
- **No rate limiting** — Cloudflare's edge protections cover the demo's scale; add `cloudflare:rate-limit` if it becomes public
- **No webhook support** — out of scope for v1
- **No HMAC-salted userId** — would close a small key-correlation hole; left as a future hardening for self-hosters who want it
- **No automated database backups** — D1's time-travel covers most cases; self-hosters get a `wrangler d1 export` recipe in the README

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
│   ├── resources/
│   │   └── templates.ts           # template://{name} resource exposure
│   ├── prompts/
│   │   └── outreach-workflow.ts   # Canonical workflow prompt (source of truth)
│   ├── types/                     # env, tool-context, db row shapes
│   └── lib/                       # steam, youtube, tavily, errors, pagination, crypto (HKDF + AES-GCM + HMAC)
├── test/                          # Vitest unit tests (auth, errors, pagination, crypto)
├── examples/
│   └── outreach-workflow.skill.md # Mirrors the server prompt for skill-aware agents
├── migrations/
│   └── 0001_initial.sql           # D1 schema (templates + sent_emails with encrypted PII)
├── wrangler.toml
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

---

## Local development

```bash
npm install
npm run db:migrate    # apply all migrations to local D1
npm run dev           # http://localhost:8787
npm run typecheck     # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
npm run test          # Vitest unit tests (auth, errors, pagination, crypto)
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
