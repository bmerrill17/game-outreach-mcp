// Opaque cursor encoding for offset-based pagination.
//
// Cursors are base64-encoded integers. We keep them opaque in the public API
// (clients should not decode or manipulate them) so we can change the encoding
// later — e.g. to keyset/seek pagination — without breaking callers.

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = atob(cursor);
    const offset = parseInt(decoded, 10);
    return Number.isFinite(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

export function encodeCursor(offset: number): string {
  return btoa(String(offset));
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (limit < 1) return 1;
  if (limit > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(limit);
}

/**
 * Given a result page that was fetched with `limit + 1` rows, returns the
 * trimmed `items` plus the `nextCursor` (or null if exhausted).
 */
export function paginate<T>(
  rows: T[],
  offset: number,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    return {
      items: rows.slice(0, limit),
      nextCursor: encodeCursor(offset + limit),
    };
  }
  return { items: rows, nextCursor: null };
}
