import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { Env } from "./types/env";
import type { ToolContext } from "./types/tool-context";
import { extractUserContext } from "./auth";
import { deriveUserCrypto } from "./lib/crypto";
import { createMcpServer, SERVER_INFO } from "./server";

const app = new Hono<{ Bindings: Env }>();

// CORS — required for browser-based MCP clients
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "x-tavily-key",
      "x-youtube-key",
      "mcp-session-id",
      "mcp-protocol-version",
    ],
    exposeHeaders: ["mcp-session-id"],
  }),
);

// Health check — useful for uptime monitoring
app.get("/health", (c) =>
  c.json({ status: "ok", name: SERVER_INFO.name, version: SERVER_INFO.version }),
);

// Root — friendly landing for someone who hits the URL in a browser
app.get("/", (c) =>
  c.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    endpoints: {
      mcp: "/mcp",
      health: "/health",
    },
    docs: "Discover usage via the `outreach-workflow` MCP prompt.",
  }),
);

// MCP endpoint — Streamable HTTP transport over Web Standard APIs.
// Each request gets a fresh server + transport in stateless mode, which keeps
// the Worker invocation self-contained and avoids cross-request state on the edge.
// Stateless = POST-only: GET (server→client SSE listener) and DELETE (session
// teardown) only make sense with a session, so we 405 them below.
app.post("/mcp", async (c) => {
  const userCtxResult = await extractUserContext(c);

  if ("error" in userCtxResult) {
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: userCtxResult.error },
        id: null,
      },
      401,
    );
  }

  // Per-request: derive AES-GCM + HMAC keys from the user's API-key pair.
  // These keys never leave the request — they're computed in memory, used to
  // encrypt/decrypt PII fields, and discarded when the handler returns.
  const userCryptoInstance = await deriveUserCrypto(
    userCtxResult.tavilyKey,
    userCtxResult.youtubeKey,
  );

  const ctx: ToolContext = {
    userId: userCtxResult.userId,
    tavilyKey: userCtxResult.tavilyKey,
    youtubeKey: userCtxResult.youtubeKey,
    db: c.env.DB,
    crypto: userCryptoInstance,
  };

  const server = createMcpServer(() => ctx);
  // Stateless: omit sessionIdGenerator so the SDK skips session management
  const transport = new WebStandardStreamableHTTPServerTransport({});

  await server.connect(transport);

  return transport.handleRequest(c.req.raw);
});

app.on(["GET", "DELETE"], "/mcp", (c) =>
  c.body(null, 405, { Allow: "POST" }),
);

// Error handler — strips sensitive headers from logs to prevent key leakage
const SENSITIVE_HEADERS = new Set([
  "x-tavily-key",
  "x-youtube-key",
  "authorization",
  "cookie",
]);

app.onError((err, c) => {
  const safeHeaders = Object.fromEntries(
    Object.entries(c.req.header()).filter(
      ([k]) => !SENSITIVE_HEADERS.has(k.toLowerCase()),
    ),
  );
  console.error({
    error: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
    headers: safeHeaders,
  });
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
