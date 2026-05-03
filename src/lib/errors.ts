// Standard MCP CallToolResult shapes.
//
// Tool results carry two parallel representations:
//   - `content`           — text fallback for any MCP client
//   - `structuredContent` — typed object that matches the tool's outputSchema
//
// Returning both is the modern best practice: clients that understand
// structuredContent get parseable typed data; older clients still see the
// JSON-stringified text. Both are derived from the same source object.

export function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

// `data` is typed as `object` (not `Record<string, unknown>`) so plain interface
// types pass the constraint — TS doesn't synthesize an index signature for them.
// The SDK validates the actual shape against the tool's outputSchema at runtime,
// so the cast inside is safe.
export function toolSuccess(data: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}
