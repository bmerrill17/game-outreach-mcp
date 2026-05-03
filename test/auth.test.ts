import { describe, expect, it, vi } from "vitest";
import { extractUserContext } from "../src/auth";

// Auth is pure header inspection + a SHA-256 derivation. We can exercise it
// with a minimal Hono-context stand-in that only implements `req.header`.

interface FakeContext {
  req: { header: (name: string) => string | undefined };
}

function ctxWithHeaders(headers: Record<string, string>): FakeContext {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] },
  };
}

describe("extractUserContext", () => {
  it("rejects when both headers are missing", async () => {
    const result = await extractUserContext(ctxWithHeaders({}) as never);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/x-tavily-key/);
      expect(result.error).toMatch(/x-youtube-key/);
    }
  });

  it("rejects when only one header is provided", async () => {
    const result = await extractUserContext(
      ctxWithHeaders({ "x-tavily-key": "tvly-abc" }) as never,
    );
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/x-youtube-key/);
      expect(result.error).not.toMatch(/x-tavily-key is required/);
    }
  });

  it("derives a stable 32-char hex userId from the key pair", async () => {
    const result = await extractUserContext(
      ctxWithHeaders({
        "x-tavily-key": "tvly-AAA",
        "x-youtube-key": "AIzaSy-BBB",
      }) as never,
    );

    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);

    expect(result.userId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.tavilyKey).toBe("tvly-AAA");
    expect(result.youtubeKey).toBe("AIzaSy-BBB");
  });

  it("returns the same userId for the same key pair across calls", async () => {
    const headers = { "x-tavily-key": "k1", "x-youtube-key": "k2" };
    const a = await extractUserContext(ctxWithHeaders(headers) as never);
    const b = await extractUserContext(ctxWithHeaders(headers) as never);

    if ("error" in a || "error" in b) throw new Error("unexpected error");
    expect(a.userId).toBe(b.userId);
  });

  it("returns different userIds when either key changes", async () => {
    const base = await extractUserContext(
      ctxWithHeaders({ "x-tavily-key": "a", "x-youtube-key": "b" }) as never,
    );
    const changedTavily = await extractUserContext(
      ctxWithHeaders({ "x-tavily-key": "a2", "x-youtube-key": "b" }) as never,
    );
    const changedYoutube = await extractUserContext(
      ctxWithHeaders({ "x-tavily-key": "a", "x-youtube-key": "b2" }) as never,
    );

    if ("error" in base || "error" in changedTavily || "error" in changedYoutube) {
      throw new Error("unexpected error");
    }
    expect(base.userId).not.toBe(changedTavily.userId);
    expect(base.userId).not.toBe(changedYoutube.userId);
  });

  // Suppress unused-import lint without affecting test behavior
  void vi;
});
