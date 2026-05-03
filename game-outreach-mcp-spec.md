# Game Outreach MCP Server — Complete Implementation Spec

## Overview

A remote MCP server built on Cloudflare Workers + Hono that provides indie game developers with a structured research and outreach management layer. The server handles Steam page scraping, content creator discovery, outreach template management, contact deduplication, and send history tracking.

The server is intentionally narrow. It does not send emails. It does not generate hooks or personalised copy. All reasoning and orchestration belongs to the agent. This server owns: external data fetching, template persistence, and send history state — the three things an agent genuinely cannot do itself.

Auth is header-based. Users pass their own third-party API keys per request. Nothing is stored except templates and send history. The repo is open source, making the no-storage claim auditable.

---

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono v4
- **MCP SDK:** `@modelcontextprotocol/sdk` latest
- **Validation:** Zod v3
- **Database:** Cloudflare D1 (SQLite at edge)
- **Language:** TypeScript strict mode throughout
- **Package manager:** npm

---

## Project Structure

```
game-outreach-mcp/
├── src/
│   ├── index.ts                  # Entry point — Hono app + MCP transport wiring
│   ├── server.ts                 # MCP server instantiation + tool + prompt registration
│   ├── auth.ts                   # Header extraction + user ID derivation
│   ├── db.ts                     # D1 client + typed query helpers
│   ├── tools/
│   │   ├── research/
│   │   │   ├── get-steam-page.ts
│   │   │   ├── find-channels.ts
│   │   │   └── get-channel-info.ts
│   │   ├── templates/
│   │   │   ├── create-template.ts
│   │   │   ├── get-template.ts
│   │   │   ├── list-templates.ts
│   │   │   ├── update-template.ts
│   │   │   └── delete-template.ts
│   │   ├── outreach/
│   │   │   ├── check-contact-eligibility.ts
│   │   │   └── record-send.ts
│   │   └── reporting/
│   │       └── get-outreach-summary.ts
│   ├── prompts/
│   │   └── outreach-workflow.ts  # Canonical workflow prompt — authoritative usage instructions
│   ├── types/
│   │   ├── env.ts                # Cloudflare env bindings type
│   │   ├── tool-context.ts       # Shared context passed to all tool handlers
│   │   └── db.ts                 # Typed D1 row shapes
│   └── lib/
│       ├── steam.ts              # Steam page scraping logic
│       ├── youtube.ts            # YouTube Data API client
│       ├── tavily.ts             # Tavily search client
│       └── errors.ts             # MCP error response helpers
├── examples/
│   └── outreach-workflow.skill.md  # Skill file for auto-loading agents (mirrors server prompt)
├── migrations/
│   └── 0001_initial.sql          # D1 schema
├── wrangler.toml
├── tsconfig.json
├── package.json
└── README.md
```

---

## TypeScript Configuration

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

---

## Environment & Bindings

`src/types/env.ts`:
```typescript
export interface Env {
  DB: D1Database;
  // Optional: your own fallback Anthropic key if you want server-side features later
  // ANTHROPIC_API_KEY: string;
}
```

All third-party keys (Tavily, YouTube) come from request headers — never from env. This is intentional and must not be changed.

---

## Auth

`src/auth.ts`:

Auth is purely header-based. There is no OAuth, no sessions, no stored credentials. A stable `userId` is derived by hashing the combination of user-supplied keys. This means the same user connecting from different machines with the same keys gets the same history — which is the correct behaviour.

```typescript
import { Context } from "hono"
import { Env } from "./types/env"

export interface UserContext {
  userId: string
  tavilyKey: string
  youtubeKey: string
}

export async function extractUserContext(
  c: Context<{ Bindings: Env }>
): Promise<UserContext | { error: string }> {
  const tavilyKey = c.req.header("x-tavily-key")
  const youtubeKey = c.req.header("x-youtube-key")

  if (!tavilyKey || !youtubeKey) {
    return {
      error: [
        "Missing required headers.",
        !tavilyKey  ? "x-tavily-key is required. Get a free key at tavily.com"   : null,
        !youtubeKey ? "x-youtube-key is required. Get a free key at console.cloud.google.com" : null,
      ]
        .filter(Boolean)
        .join(" "),
    }
  }

  // Derive a stable userId from the key pair — no storage needed
  const raw = `${tavilyKey}:${youtubeKey}`
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
  const userId = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)

  return { userId, tavilyKey, youtubeKey }
}
```

---

## D1 Database Schema

`migrations/0001_initial.sql`:

```sql
-- Templates: user-defined outreach templates with semantic names
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,           -- semantic name, user-defined, e.g. "initial-outreach"
  subject     TEXT NOT NULL,           -- email subject, supports {{channel_name}} {{game_name}}
  body        TEXT NOT NULL,           -- email body, supports {{channel_name}} {{game_name}} {{hook}}
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(user_id, name)                -- template names are unique per user
);

-- Sent history: immutable log of every send event
CREATE TABLE IF NOT EXISTS sent_emails (
  id             TEXT NOT NULL PRIMARY KEY,
  user_id        TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  channel_url    TEXT,
  channel_name   TEXT,
  game_id        TEXT NOT NULL,        -- Steam app ID
  template_name  TEXT NOT NULL,        -- semantic name at time of send
  sent_at        TEXT NOT NULL,
  sent_via       TEXT,                 -- informational: "gmail", "resend", etc.
  notes          TEXT                  -- optional freeform field for agent context
);

-- Indexes for the most common query patterns
CREATE INDEX IF NOT EXISTS idx_sent_user_game_template
  ON sent_emails(user_id, game_id, template_name);

CREATE INDEX IF NOT EXISTS idx_sent_user_contact
  ON sent_emails(user_id, contact_email);

CREATE INDEX IF NOT EXISTS idx_templates_user
  ON templates(user_id);
```

---

## D1 Client

`src/db.ts`:

```typescript
import { Env } from "./types/env"

// Typed row shapes — match schema exactly
export interface TemplateRow {
  id:         string
  user_id:    string
  name:       string
  subject:    string
  body:       string
  created_at: string
  updated_at: string
}

export interface SentEmailRow {
  id:            string
  user_id:       string
  contact_email: string
  channel_url:   string | null
  channel_name:  string | null
  game_id:       string
  template_name: string
  sent_at:       string
  sent_via:      string | null
  notes:         string | null
}

export function getDb(env: Env): D1Database {
  return env.DB
}

export async function getTemplate(
  db: D1Database,
  userId: string,
  name: string
): Promise<TemplateRow | null> {
  const result = await db
    .prepare("SELECT * FROM templates WHERE user_id = ? AND name = ?")
    .bind(userId, name)
    .first<TemplateRow>()
  return result ?? null
}

export async function getSentEmails(
  db: D1Database,
  userId: string,
  gameId: string,
  templateName: string
): Promise<SentEmailRow[]> {
  const result = await db
    .prepare(
      "SELECT * FROM sent_emails WHERE user_id = ? AND game_id = ? AND template_name = ?"
    )
    .bind(userId, gameId, templateName)
    .all<SentEmailRow>()
  return result.results
}
```

---

## Error Helpers

`src/lib/errors.ts`:

```typescript
// Standard MCP error response shape
export function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true as const,
  }
}

export function toolSuccess(data: unknown) {
  return {
    content: [{ 
      type: "text" as const, 
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2) 
    }],
  }
}
```

---

## External API Clients

### `src/lib/steam.ts`

```typescript
export interface SteamGameData {
  appId:       string
  name:        string
  description: string
  tags:        string[]
  genres:      string[]
  developer:   string
  releaseDate: string
  reviewScore: string | null
}

export async function fetchSteamPage(url: string): Promise<SteamGameData> {
  // Extract app ID from URL
  // Handles: store.steampowered.com/app/1234567/Game_Name/
  const match = url.match(/store\.steampowered\.com\/app\/(\d+)/)
  if (!match?.[1]) throw new Error(`Cannot extract Steam app ID from URL: ${url}`)
  const appId = match[1]

  // Use Steam store API — no key required for basic data
  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`
  )
  if (!res.ok) throw new Error(`Steam API error: ${res.status}`)

  const json = await res.json() as Record<string, { success: boolean; data: SteamAppData }>
  const entry = json[appId]
  if (!entry?.success) throw new Error(`Steam returned no data for app ID ${appId}`)

  const d = entry.data
  return {
    appId,
    name:        d.name,
    description: d.short_description,
    tags:        (d.categories ?? []).map((c: { description: string }) => c.description),
    genres:      (d.genres ?? []).map((g: { description: string }) => g.description),
    developer:   d.developers?.[0] ?? "Unknown",
    releaseDate: d.release_date?.date ?? "Unknown",
    reviewScore: d.metacritic?.score?.toString() ?? null,
  }
}

// Internal Steam API shape — only what we use
interface SteamAppData {
  name:              string
  short_description: string
  categories:        { description: string }[]
  genres:            { description: string }[]
  developers:        string[]
  release_date:      { date: string }
  metacritic:        { score: number } | null
}
```

### `src/lib/tavily.ts`

```typescript
export interface TavilySearchResult {
  title:   string
  url:     string
  content: string
  score:   number
}

export async function tavilySearch(
  query:  string,
  apiKey: string,
  maxResults = 10
): Promise<TavilySearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results:    maxResults,
      search_depth:   "advanced",
      include_answer: false,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tavily error ${res.status}: ${text}`)
  }
  const data = await res.json() as { results: TavilySearchResult[] }
  return data.results
}
```

### `src/lib/youtube.ts`

```typescript
export interface YouTubeChannelShallow {
  channelId:   string
  name:        string
  url:         string
  description: string
  subscribers: number | null
}

export interface YouTubeChannelDetail extends YouTubeChannelShallow {
  recentVideos:  { title: string; publishedAt: string; url: string }[]
  contactEmail:  string | null
  country:       string | null
  customUrl:     string | null
}

export async function searchYouTubeChannels(
  query:     string,
  apiKey:    string,
  maxResults = 10
): Promise<YouTubeChannelShallow[]> {
  const searchRes = await fetch(
    `https://www.googleapis.com/youtube/v3/search?` +
    new URLSearchParams({
      part:       "snippet",
      q:          query,
      type:       "channel",
      maxResults: String(maxResults),
      key:        apiKey,
    })
  )
  if (!searchRes.ok) throw new Error(`YouTube search error: ${searchRes.status}`)

  const searchData = await searchRes.json() as YouTubeSearchResponse
  const channelIds = searchData.items.map(i => i.id.channelId).join(",")

  // Fetch subscriber counts in same call
  const statsRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?` +
    new URLSearchParams({
      part: "statistics,snippet",
      id:   channelIds,
      key:  apiKey,
    })
  )
  if (!statsRes.ok) throw new Error(`YouTube channel stats error: ${statsRes.status}`)

  const statsData = await statsRes.json() as YouTubeChannelsResponse

  return statsData.items.map(ch => ({
    channelId:   ch.id,
    name:        ch.snippet.title,
    url:         `https://www.youtube.com/channel/${ch.id}`,
    description: ch.snippet.description,
    subscribers: ch.statistics.subscriberCount
      ? parseInt(ch.statistics.subscriberCount, 10)
      : null,
  }))
}

export async function getYouTubeChannelDetail(
  channelUrl: string,
  apiKey:     string
): Promise<YouTubeChannelDetail> {
  // Resolve channel ID from URL — handle multiple URL formats
  const channelId = await resolveChannelId(channelUrl, apiKey)

  const [channelRes, videosRes] = await Promise.all([
    fetch(
      `https://www.googleapis.com/youtube/v3/channels?` +
      new URLSearchParams({
        part: "snippet,statistics,brandingSettings",
        id:   channelId,
        key:  apiKey,
      })
    ),
    fetch(
      `https://www.googleapis.com/youtube/v3/search?` +
      new URLSearchParams({
        part:       "snippet",
        channelId,
        order:      "date",
        type:       "video",
        maxResults: "10",
        key:        apiKey,
      })
    ),
  ])

  if (!channelRes.ok) throw new Error(`YouTube channel detail error: ${channelRes.status}`)
  if (!videosRes.ok)  throw new Error(`YouTube videos error: ${videosRes.status}`)

  const channelData = await channelRes.json() as YouTubeChannelsResponse
  const videosData  = await videosRes.json() as YouTubeSearchResponse

  const ch = channelData.items[0]
  if (!ch) throw new Error(`Channel not found for URL: ${channelUrl}`)

  // Extract contact email from description heuristically
  const emailMatch = ch.snippet.description.match(
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/
  )

  return {
    channelId,
    name:         ch.snippet.title,
    url:          channelUrl,
    description:  ch.snippet.description,
    subscribers:  ch.statistics.subscriberCount
      ? parseInt(ch.statistics.subscriberCount, 10)
      : null,
    country:      ch.snippet.country ?? null,
    customUrl:    ch.snippet.customUrl ?? null,
    contactEmail: emailMatch?.[0] ?? null,
    recentVideos: videosData.items.map(v => ({
      title:       v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      url:         `https://www.youtube.com/watch?v=${v.id.videoId}`,
    })),
  }
}

async function resolveChannelId(url: string, apiKey: string): Promise<string> {
  // Direct channel ID in URL
  const idMatch = url.match(/youtube\.com\/channel\/(UC[\w-]+)/)
  if (idMatch?.[1]) return idMatch[1]

  // Handle, @username — resolve via search
  const handleMatch = url.match(/youtube\.com\/@?([\w-]+)/)
  if (handleMatch?.[1]) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?` +
      new URLSearchParams({
        part:       "id",
        forHandle:  `@${handleMatch[1]}`,
        key:        apiKey,
      })
    )
    const data = await res.json() as YouTubeChannelsResponse
    const id = data.items[0]?.id
    if (!id) throw new Error(`Could not resolve YouTube channel from URL: ${url}`)
    return id
  }

  throw new Error(`Unrecognised YouTube URL format: ${url}`)
}

// YouTube API response shapes
interface YouTubeSearchResponse {
  items: {
    id:      { channelId: string; videoId?: string }
    snippet: { title: string; description: string; publishedAt: string }
  }[]
}

interface YouTubeChannelsResponse {
  items: {
    id:         string
    snippet:    { title: string; description: string; country?: string; customUrl?: string }
    statistics: { subscriberCount?: string }
  }[]
}
```

---

## Tool Context Type

`src/types/tool-context.ts`:

```typescript
import { D1Database } from "@cloudflare/workers-types"

export interface ToolContext {
  userId:     string
  tavilyKey:  string
  youtubeKey: string
  db:         D1Database
}
```

---

## Tool Implementations

### `src/tools/research/get-steam-page.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { fetchSteamPage } from "../../lib/steam"
import { toolError, toolSuccess } from "../../lib/errors"

export const GetSteamPageSchema = z.object({
  url: z.string().url().describe(
    "Full Steam store URL e.g. https://store.steampowered.com/app/1234567/Game_Name/"
  ),
})

export function registerGetSteamPage(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "get_steam_page",
    "Fetches and parses a Steam store page returning structured game data including tags, genres, description and developer. Use this as the first step in any outreach workflow to extract the game context needed for channel matching.",
    GetSteamPageSchema.shape,
    async ({ url }) => {
      try {
        const data = await fetchSteamPage(url)
        return toolSuccess(data)
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to fetch Steam page")
      }
    }
  )
}
```

---

### `src/tools/research/find-channels.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { searchYouTubeChannels } from "../../lib/youtube"
import { tavilySearch } from "../../lib/tavily"
import { toolError, toolSuccess } from "../../lib/errors"

export const FindChannelsSchema = z.object({
  tags: z.array(z.string()).min(1).describe(
    "Game tags or genres from Steam page e.g. ['tactics', 'strategy', 'indie', 'turn-based']"
  ),
  game_name: z.string().describe(
    "Name of the game — used to refine search queries"
  ),
  max_results: z.number().int().min(1).max(50).default(20).describe(
    "Maximum number of channels to return across all sources"
  ),
  sources: z.array(z.enum(["youtube", "tavily"])).default(["youtube", "tavily"]).describe(
    "Which sources to search. YouTube finds channels directly. Tavily finds coverage across blogs and smaller sites."
  ),
})

export function registerFindChannels(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "find_channels",
    "Searches for content creator channels relevant to a game based on its tags. Returns shallow channel data suitable for deciding which channels warrant a deeper look via get_channel_info. Searches YouTube directly and optionally broader web via Tavily.",
    FindChannelsSchema.shape,
    async ({ tags, game_name, max_results, sources }) => {
      const ctx = getCtx()
      
      try {
        const query = `${game_name} ${tags.slice(0, 4).join(" ")} game review coverage`
        const perSource = Math.ceil(max_results / sources.length)
        const results: unknown[] = []

        if (sources.includes("youtube")) {
          const ytResults = await searchYouTubeChannels(query, ctx.youtubeKey, perSource)
          results.push(...ytResults.map(r => ({ ...r, source: "youtube" })))
        }

        if (sources.includes("tavily")) {
          const tvResults = await tavilySearch(
            `${query} youtube channel site:youtube.com`,
            ctx.tavilyKey,
            perSource
          )
          results.push(...tvResults.map(r => ({ ...r, source: "tavily" })))
        }

        return toolSuccess({ count: results.length, channels: results })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Channel search failed")
      }
    }
  )
}
```

---

### `src/tools/research/get-channel-info.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { getYouTubeChannelDetail } from "../../lib/youtube"
import { toolError, toolSuccess } from "../../lib/errors"

export const GetChannelInfoSchema = z.object({
  channel_url: z.string().url().describe(
    "YouTube channel URL — supports /channel/UC..., /@handle, and /c/name formats"
  ),
})

export function registerGetChannelInfo(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "get_channel_info",
    "Fetches detailed information about a specific YouTube channel including recent video titles, contact email extracted from channel description, subscriber count, and country. Recent video titles are the primary input for hook generation — use this before drafting any outreach for a channel.",
    GetChannelInfoSchema.shape,
    async ({ channel_url }) => {
      const ctx = getCtx()
      try {
        const detail = await getYouTubeChannelDetail(channel_url, ctx.youtubeKey)
        return toolSuccess(detail)
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to fetch channel info")
      }
    }
  )
}
```

---

### `src/tools/templates/create-template.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { toolError, toolSuccess } from "../../lib/errors"

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/, {
    message: "Template name must be lowercase alphanumeric with hyphens only e.g. initial-outreach"
  }).describe("Semantic name for this template e.g. 'initial-outreach', 'follow-up-7day', 'review-request'"),
  subject: z.string().min(1).describe(
    "Email subject line. Supports {{channel_name}} and {{game_name}} placeholders."
  ),
  body: z.string().min(1).describe(
    "Email body. Supports {{channel_name}}, {{game_name}}, and {{hook}} placeholders. The {{hook}} placeholder is where the agent inserts the personalised game-to-channel connection paragraph."
  ),
})

export function registerCreateTemplate(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "create_template",
    "Creates a new outreach email template with a semantic name. Template names must be unique per user and use lowercase-hyphenated format. Use {{hook}} in the body where personalised content should be inserted by the agent at send time.",
    CreateTemplateSchema.shape,
    async ({ name, subject, body }) => {
      const ctx = getCtx()
      const now = new Date().toISOString()
      const id  = crypto.randomUUID()

      try {
        await ctx.db
          .prepare(
            "INSERT INTO templates (id, user_id, name, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(id, ctx.userId, name, subject, body, now, now)
          .run()

        return toolSuccess({ id, name, subject, body, created_at: now })
      } catch (err) {
        // D1 unique constraint violation
        if (err instanceof Error && err.message.includes("UNIQUE")) {
          return toolError(`Template with name "${name}" already exists. Use update_template to modify it.`)
        }
        return toolError(err instanceof Error ? err.message : "Failed to create template")
      }
    }
  )
}
```

---

### `src/tools/templates/get-template.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { getTemplate } from "../../db"
import { toolError, toolSuccess } from "../../lib/errors"

export const GetTemplateSchema = z.object({
  name: z.string().describe("Semantic name of the template to retrieve"),
})

export function registerGetTemplate(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "get_template",
    "Retrieves a specific template by its semantic name. Returns the full template including subject and body with placeholders intact.",
    GetTemplateSchema.shape,
    async ({ name }) => {
      const ctx      = getCtx()
      const template = await getTemplate(ctx.db, ctx.userId, name)
      if (!template) return toolError(`Template "${name}" not found.`)
      return toolSuccess(template)
    }
  )
}
```

---

### `src/tools/templates/list-templates.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { toolError, toolSuccess } from "../../lib/errors"
import { TemplateRow } from "../../db"

export function registerListTemplates(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "list_templates",
    "Returns all outreach templates for the current user. Use this to discover available templates before starting an outreach run.",
    {},
    async () => {
      const ctx = getCtx()
      try {
        const result = await ctx.db
          .prepare("SELECT id, name, subject, created_at, updated_at FROM templates WHERE user_id = ? ORDER BY created_at DESC")
          .bind(ctx.userId)
          .all<Pick<TemplateRow, "id" | "name" | "subject" | "created_at" | "updated_at">>()

        return toolSuccess({ count: result.results.length, templates: result.results })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to list templates")
      }
    }
  )
}
```

---

### `src/tools/templates/update-template.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { getTemplate } from "../../db"
import { toolError, toolSuccess } from "../../lib/errors"

export const UpdateTemplateSchema = z.object({
  name:    z.string().describe("Semantic name of the template to update"),
  subject: z.string().min(1).optional().describe("New subject line — omit to keep existing"),
  body:    z.string().min(1).optional().describe("New body — omit to keep existing"),
})

export function registerUpdateTemplate(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "update_template",
    "Updates an existing template's subject or body. Provide only the fields you want to change. Template name cannot be changed — delete and recreate if a rename is needed.",
    UpdateTemplateSchema.shape,
    async ({ name, subject, body }) => {
      const ctx      = getCtx()
      const existing = await getTemplate(ctx.db, ctx.userId, name)
      if (!existing) return toolError(`Template "${name}" not found.`)

      const newSubject = subject ?? existing.subject
      const newBody    = body    ?? existing.body
      const now        = new Date().toISOString()

      await ctx.db
        .prepare("UPDATE templates SET subject = ?, body = ?, updated_at = ? WHERE user_id = ? AND name = ?")
        .bind(newSubject, newBody, now, ctx.userId, name)
        .run()

      return toolSuccess({ name, subject: newSubject, body: newBody, updated_at: now })
    }
  )
}
```

---

### `src/tools/templates/delete-template.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { getTemplate } from "../../db"
import { toolError, toolSuccess } from "../../lib/errors"

export const DeleteTemplateSchema = z.object({
  name: z.string().describe("Semantic name of the template to delete"),
})

export function registerDeleteTemplate(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "delete_template",
    "Permanently deletes a template. Send history referencing this template name is preserved — history records are immutable. This action cannot be undone.",
    DeleteTemplateSchema.shape,
    async ({ name }) => {
      const ctx      = getCtx()
      const existing = await getTemplate(ctx.db, ctx.userId, name)
      if (!existing) return toolError(`Template "${name}" not found.`)

      await ctx.db
        .prepare("DELETE FROM templates WHERE user_id = ? AND name = ?")
        .bind(ctx.userId, name)
        .run()

      return toolSuccess({ deleted: name })
    }
  )
}
```

---

### `src/tools/outreach/check-contact-eligibility.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { toolError, toolSuccess } from "../../lib/errors"

export const CheckContactEligibilitySchema = z.object({
  contacts: z.array(
    z.object({
      email:        z.string().email(),
      channel_url:  z.string().url().optional(),
      channel_name: z.string().optional(),
    })
  ).min(1).describe("List of contacts to check"),
  template_name: z.string().describe(
    "Semantic template name to check against — contacts who have already received this template for this game are excluded"
  ),
  game_id: z.string().describe(
    "Steam app ID for the game — deduplication is scoped per game so the same contact can receive outreach for different games"
  ),
})

export function registerCheckContactEligibility(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "check_contact_eligibility",
    "Filters a list of contacts to only those who have NOT yet been sent a specific template for a specific game. Returns both eligible and skipped lists with reasons. Always call this before any outreach run to prevent duplicate sends.",
    CheckContactEligibilitySchema.shape,
    async ({ contacts, template_name, game_id }) => {
      const ctx = getCtx()

      try {
        const history = await ctx.db
          .prepare(
            "SELECT contact_email, sent_at FROM sent_emails WHERE user_id = ? AND game_id = ? AND template_name = ?"
          )
          .bind(ctx.userId, game_id, template_name)
          .all<{ contact_email: string; sent_at: string }>()

        const sentMap = new Map(history.results.map(r => [r.contact_email, r.sent_at]))

        const eligible = contacts.filter(c => !sentMap.has(c.email))
        const skipped  = contacts
          .filter(c => sentMap.has(c.email))
          .map(c => ({ ...c, previously_sent_at: sentMap.get(c.email) }))

        return toolSuccess({
          eligible_count: eligible.length,
          skipped_count:  skipped.length,
          eligible,
          skipped,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Eligibility check failed")
      }
    }
  )
}
```

---

### `src/tools/outreach/record-send.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { toolError, toolSuccess } from "../../lib/errors"

export const RecordSendSchema = z.object({
  contact_email: z.string().email().describe("Email address that was sent to"),
  game_id:       z.string().describe("Steam app ID of the game being pitched"),
  template_name: z.string().describe("Semantic name of the template that was sent"),
  channel_url:   z.string().url().optional().describe("YouTube channel URL if applicable"),
  channel_name:  z.string().optional().describe("Display name of the channel"),
  sent_via:      z.string().optional().describe("Informational — which email tool was used e.g. 'gmail', 'resend'"),
  notes:         z.string().optional().describe("Any additional context to record e.g. personalisation notes, hook used"),
})

export function registerRecordSend(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "record_send",
    "Records a completed outreach email send to the tracking history. Call this immediately after a successful send via your email MCP. This is what prevents duplicate sends in future runs. Records are immutable — there is no delete or update for send history.",
    RecordSendSchema.shape,
    async ({ contact_email, game_id, template_name, channel_url, channel_name, sent_via, notes }) => {
      const ctx = getCtx()
      const id  = crypto.randomUUID()
      const now = new Date().toISOString()

      try {
        await ctx.db
          .prepare(
            `INSERT INTO sent_emails 
              (id, user_id, contact_email, channel_url, channel_name, game_id, template_name, sent_at, sent_via, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            ctx.userId,
            contact_email,
            channel_url   ?? null,
            channel_name  ?? null,
            game_id,
            template_name,
            now,
            sent_via ?? null,
            notes    ?? null,
          )
          .run()

        return toolSuccess({
          recorded:      true,
          id,
          contact_email,
          game_id,
          template_name,
          sent_at:       now,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to record send")
      }
    }
  )
}
```

---

### `src/tools/reporting/get-outreach-summary.ts`

```typescript
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../../types/tool-context"
import { toolError, toolSuccess } from "../../lib/errors"

export const GetOutreachSummarySchema = z.object({
  game_id: z.string().optional().describe(
    "Filter to a specific game by Steam app ID. Omit to get summary across all games."
  ),
})

export function registerGetOutreachSummary(server: McpServer, getCtx: () => ToolContext) {
  server.tool(
    "get_outreach_summary",
    "Returns a summary of outreach activity grouped by game and template. Shows total sends, most recent send date, and unique contacts reached. Use this to understand campaign coverage before starting a new outreach run.",
    GetOutreachSummarySchema.shape,
    async ({ game_id }) => {
      const ctx = getCtx()

      try {
        const query = game_id
          ? `SELECT 
               game_id,
               template_name,
               COUNT(*)                    AS total_sends,
               COUNT(DISTINCT contact_email) AS unique_contacts,
               MAX(sent_at)                AS last_sent_at
             FROM sent_emails
             WHERE user_id = ? AND game_id = ?
             GROUP BY game_id, template_name
             ORDER BY last_sent_at DESC`
          : `SELECT 
               game_id,
               template_name,
               COUNT(*)                    AS total_sends,
               COUNT(DISTINCT contact_email) AS unique_contacts,
               MAX(sent_at)                AS last_sent_at
             FROM sent_emails
             WHERE user_id = ?
             GROUP BY game_id, template_name
             ORDER BY last_sent_at DESC`

        const result = game_id
          ? await ctx.db.prepare(query).bind(ctx.userId, game_id).all()
          : await ctx.db.prepare(query).bind(ctx.userId).all()

        return toolSuccess({
          total_records: result.results.length,
          summary:       result.results,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Failed to fetch summary")
      }
    }
  )
}
```

---

## MCP Prompts

Prompts are the MCP-native way to ship workflow instructions with the server. They are the **canonical, authoritative source** of usage documentation — discoverable by any MCP client via `prompts/list` and `prompts/get`. The skill file in `/examples` is a convenience mirror of this content for agents that benefit from auto-loaded context.

When this prompt content is updated, the skill file must be updated to match. The prompt is the source of truth.

`src/prompts/outreach-workflow.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

// WORKFLOW_CONTENT is defined as a constant so it can be exported
// and used to keep the examples/outreach-workflow.skill.md in sync.
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
`

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "outreach-workflow",
    "Complete workflow instructions for running an indie game media outreach campaign using this server. Read this before starting any outreach run.",
    {},
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: OUTREACH_WORKFLOW_CONTENT,
          },
        },
      ],
    })
  )
}
```

---

## MCP Server Assembly

`src/server.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "./types/tool-context"
import { registerGetSteamPage }            from "./tools/research/get-steam-page"
import { registerFindChannels }            from "./tools/research/find-channels"
import { registerGetChannelInfo }          from "./tools/research/get-channel-info"
import { registerCreateTemplate }          from "./tools/templates/create-template"
import { registerGetTemplate }             from "./tools/templates/get-template"
import { registerListTemplates }           from "./tools/templates/list-templates"
import { registerUpdateTemplate }          from "./tools/templates/update-template"
import { registerDeleteTemplate }          from "./tools/templates/delete-template"
import { registerCheckContactEligibility } from "./tools/outreach/check-contact-eligibility"
import { registerRecordSend }              from "./tools/outreach/record-send"
import { registerGetOutreachSummary }      from "./tools/reporting/get-outreach-summary"
import { registerPrompts }                 from "./prompts/outreach-workflow"

export function createMcpServer(getCtx: () => ToolContext): McpServer {
  const server = new McpServer({
    name:    "game-outreach-mcp",
    version: "1.0.0",
  })

  // Research
  registerGetSteamPage(server, getCtx)
  registerFindChannels(server, getCtx)
  registerGetChannelInfo(server, getCtx)

  // Templates
  registerCreateTemplate(server, getCtx)
  registerGetTemplate(server, getCtx)
  registerListTemplates(server, getCtx)
  registerUpdateTemplate(server, getCtx)
  registerDeleteTemplate(server, getCtx)

  // Outreach
  registerCheckContactEligibility(server, getCtx)
  registerRecordSend(server, getCtx)

  // Reporting
  registerGetOutreachSummary(server, getCtx)

  // Prompts — canonical workflow instructions, discoverable by any MCP client
  registerPrompts(server)

  return server
}
```

---

## Entry Point

`src/index.ts`:

```typescript
import { Hono }                      from "hono"
import { cors }                      from "hono/cors"
import { McpServer }                 from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport }        from "@modelcontextprotocol/sdk/server/sse.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { Env }                       from "./types/env"
import { extractUserContext }        from "./auth"
import { createMcpServer }           from "./server"
import { ToolContext }               from "./types/tool-context"

const app = new Hono<{ Bindings: Env }>()

// CORS — required for browser-based MCP clients
app.use("*", cors({
  origin:  "*",
  methods: ["GET", "POST", "OPTIONS"],
  headers: ["Content-Type", "Authorization", "x-tavily-key", "x-youtube-key"],
}))

// Health check — useful for uptime monitoring and client connectivity tests
app.get("/health", c => c.json({ status: "ok", version: "1.0.0" }))

// MCP endpoint — Streamable HTTP transport (MCP spec recommended for remote servers)
app.all("/mcp", async c => {
  const userCtxResult = await extractUserContext(c)

  if ("error" in userCtxResult) {
    return c.json({ error: userCtxResult.error }, 401)
  }

  const ctx: ToolContext = {
    ...userCtxResult,
    db: c.env.DB,
  }

  const server    = createMcpServer(() => ctx)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  })

  // Wire MCP server to transport and handle request
  await server.connect(transport)
  return transport.handleRequest(c.req.raw, new Response())
})

// SSE endpoint — legacy support for clients that use SSE transport
app.get("/sse", async c => {
  const userCtxResult = await extractUserContext(c)
  if ("error" in userCtxResult) return c.json({ error: userCtxResult.error }, 401)

  const ctx: ToolContext = { ...userCtxResult, db: c.env.DB }
  const server           = createMcpServer(() => ctx)
  const transport        = new SSEServerTransport("/messages", c.res as unknown as Response)

  await server.connect(transport)
  return transport.start()
})

// Error handler — explicitly strips headers from logs to prevent key leakage
app.onError((err, c) => {
  const safeHeaders = Object.fromEntries(
    Object.entries(c.req.header()).filter(
      ([k]) => !["x-tavily-key", "x-youtube-key", "authorization"].includes(k.toLowerCase())
    )
  )
  console.error({
    error:   err.message,
    path:    c.req.path,
    method:  c.req.method,
    headers: safeHeaders,
  })
  return c.json({ error: "Internal server error" }, 500)
})

export default app
```

---

## Wrangler Configuration

`wrangler.toml`:

```toml
name = "game-outreach-mcp"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding  = "DB"
database_name = "game-outreach-mcp-db"
database_id   = "REPLACE_WITH_YOUR_D1_ID"

[vars]
# No secrets here — all keys come from request headers

# Optional: preview environment
[[env.preview.d1_databases]]
binding  = "DB"
database_name = "game-outreach-mcp-db-preview"
database_id   = "REPLACE_WITH_YOUR_PREVIEW_D1_ID"
```

---

## Package Configuration

`package.json`:

```json
{
  "name": "game-outreach-mcp",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev":     "wrangler dev",
    "deploy":  "wrangler deploy",
    "db:init": "wrangler d1 execute game-outreach-mcp-db --file=./migrations/0001_initial.sql",
    "db:init:preview": "wrangler d1 execute game-outreach-mcp-db-preview --file=./migrations/0001_initial.sql --env preview",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src --ext .ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "hono":                      "^4.0.0",
    "zod":                       "^3.23.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "typescript":                "^5.4.0",
    "wrangler":                  "^3.0.0"
  }
}
```

---

## Deployment Instructions

### Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### Step 1 — Install dependencies

```bash
npm install
```

### Step 2 — Create D1 database

```bash
wrangler d1 create game-outreach-mcp-db
```

Copy the `database_id` from the output into `wrangler.toml`.

### Step 3 — Run migrations

```bash
npm run db:init
```

### Step 4 — Type check

```bash
npm run typecheck
```

Fix any type errors before deploying. There should be none if the spec is followed exactly.

### Step 5 — Test locally

```bash
npm run dev
```

Server is now running at `http://localhost:8787`. Test the health endpoint:

```bash
curl http://localhost:8787/health
```

Test a tool call with headers:

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "x-tavily-key: your-tavily-key" \
  -H "x-youtube-key: your-youtube-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

Should return all 11 tools.

Test that the prompt is discoverable:

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "x-tavily-key: your-tavily-key" \
  -H "x-youtube-key: your-youtube-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "prompts/list",
    "id": 2
  }'
```

Should return the `outreach-workflow` prompt.

### Step 6 — Deploy

```bash
npm run deploy
```

Wrangler outputs your production URL:
```
https://game-outreach-mcp.YOUR_SUBDOMAIN.workers.dev
```

### Step 7 — Run production migrations

```bash
wrangler d1 execute game-outreach-mcp-db \
  --file=./migrations/0001_initial.sql \
  --remote
```

### Step 8 — Connect to Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop. The 11 tools should appear.

---

## Skill File for Auto-Loading Agents

`examples/outreach-workflow.skill.md`

This file is a **convenience mirror** of the `outreach-workflow` MCP Prompt registered in `src/prompts/outreach-workflow.ts`. The server prompt is the canonical source of truth — this file exists for agents (like Claude Code) that benefit from having instructions auto-loaded into context at session start rather than fetching them via `prompts/get`.

**When updating workflow instructions, update `src/prompts/outreach-workflow.ts` first, then sync this file to match.** The `OUTREACH_WORKFLOW_CONTENT` constant is exported from the prompt file specifically to make this diffing straightforward.

Users can drop this file into their Claude Code project or skill folder. It does not replace the server prompt — both should be present.

```md
# Game Outreach Workflow

## Overview
Use the game-outreach MCP server to research and manage indie game media outreach.
The server handles data and state. You handle all reasoning, hook generation, and orchestration.

## Standard Outreach Run

1. `get_steam_page` with the game's Steam URL to extract tags, description, game_id
2. `list_templates` to confirm which templates exist
3. `find_channels` using game tags + game name — aim for 20-30 results
4. Filter by relevance: prioritise channels with 5k-200k subscribers for indie games
5. For each shortlisted channel: `get_channel_info` to get recent videos and contact email
6. `check_contact_eligibility` to filter contacts for the chosen template and game_id
7. For each eligible contact:
   a. Read their recent video titles from get_channel_info output
   b. Generate a specific 2-3 sentence hook connecting the game to their content — reference actual video titles by name, not generically
   c. Retrieve template with `get_template`
   d. Substitute {{channel_name}}, {{game_name}}, {{hook}} yourself
   e. Send via the user's email MCP
   f. Immediately call `record_send` on success
8. `get_outreach_summary` to report on the completed run

## Hook Writing Guidelines
- Reference a specific recent video by title — never generic ("I see you cover strategy games")
- Connect one specific game mechanic to what they clearly enjoy covering
- Keep to 2-3 sentences maximum
- Do not mention competitor games
- Do not use superlatives (amazing, incredible, unique)

## Template Placeholder Reference
- {{channel_name}} — display name of the YouTube channel
- {{game_name}} — name of the game from Steam
- {{hook}} — insert your generated personalised paragraph here

## Deduplication
The server tracks every send by contact_email + game_id + template_name.
check_contact_eligibility will exclude anyone already sent a given template for a given game.
A contact can receive different templates, and can receive the same template for different games.
```

---

## README Sections (Include in Repo)

```md
## Usage

This server is self-documenting via MCP Prompts. Once connected, call `prompts/list`
to discover available prompts, then `prompts/get` with name `outreach-workflow` to load
the full workflow instructions into your agent's context.

A pre-built skill file is available at `examples/outreach-workflow.skill.md` for agents
that benefit from auto-loaded context (e.g. Claude Code). It mirrors the server prompt —
the server prompt is the authoritative version.
## Auth

This server never stores your API keys. Keys passed via request headers are used
for that request only and immediately discarded. You can verify this in src/auth.ts —
keys are hashed to derive a stable user ID and never written to any storage.

Your send history and templates are stored in Cloudflare D1, scoped to the hash
of your key combination. If you change your keys your history will not be accessible
under the new key pair.

## Required Headers

Every request must include:
- x-tavily-key — get a free key at tavily.com
- x-youtube-key — get a free key at console.cloud.google.com (YouTube Data API v3)

## What This Server Does Not Do

- Send emails — use your own Gmail MCP, Resend MCP, or any email tool
- Generate personalised copy — your agent does this
- Store API keys — derived hash only
- Access your game files or Unity project
```

---

## What This Spec Does Not Cover (Intentional Scope Boundaries)

- Rate limiting per user — add Cloudflare's built-in rate limiting if this becomes a public product with abuse risk
- Pagination on list endpoints — D1 result sets are small enough at this scale; add `LIMIT/OFFSET` if needed later
- Webhook support — out of scope for v1
- Any email sending — intentionally excluded; belongs to the user's own tooling
