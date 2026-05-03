import { describe, expect, it } from "vitest";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  paginate,
} from "../src/lib/pagination";

describe("pagination cursor", () => {
  it("encodes and decodes integers round-trip", () => {
    expect(decodeCursor(encodeCursor(0))).toBe(0);
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(encodeCursor(99999))).toBe(99999);
  });

  it("treats undefined and empty cursors as offset 0", () => {
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor("")).toBe(0);
  });

  it("returns 0 for malformed cursors instead of throwing", () => {
    expect(decodeCursor("not-base64-!@#")).toBe(0);
    expect(decodeCursor(encodeCursor(-5))).toBe(0);
  });
});

describe("clampLimit", () => {
  it("uses default when undefined", () => {
    expect(clampLimit(undefined)).toBe(25);
  });

  it("respects valid limits", () => {
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(100)).toBe(100);
  });

  it("clamps below 1 and above 100", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(500)).toBe(100);
  });
});

describe("paginate", () => {
  it("returns no nextCursor when result fits on one page", () => {
    const rows = [1, 2, 3];
    const result = paginate(rows, 0, 10);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.nextCursor).toBeNull();
  });

  it("returns nextCursor when result exceeds page size (oversize-by-one)", () => {
    // Caller fetches `limit + 1` rows; if the extra row exists, more pages remain.
    const rows = [1, 2, 3, 4]; // 4 rows fetched with limit=3
    const result = paginate(rows, 0, 3);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.nextCursor).not.toBeNull();
    expect(decodeCursor(result.nextCursor!)).toBe(3);
  });

  it("advances offset correctly across pages", () => {
    const page2 = paginate([4, 5, 6, 7], 3, 3);
    expect(decodeCursor(page2.nextCursor!)).toBe(6);
  });
});
