import { describe, expect, it } from "vitest";
import { toolError, toolSuccess } from "../src/lib/errors";

describe("toolError", () => {
  it("returns a CallToolResult shape with isError set", () => {
    const result = toolError("oops");
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: "Error: oops" });
  });
});

describe("toolSuccess", () => {
  it("returns parallel content (text) and structuredContent (object)", () => {
    const data = { foo: "bar", count: 3 };
    const result = toolSuccess(data);

    expect(result.structuredContent).toEqual(data);
    expect(result.content[0]?.type).toBe("text");
    // The text representation must round-trip back to the structured object so
    // pre-structuredContent clients see exactly the same data.
    expect(JSON.parse(result.content[0]!.text!)).toEqual(data);
  });

  it("does not set isError for successful results", () => {
    const result = toolSuccess({ ok: true });
    expect("isError" in result).toBe(false);
  });
});
