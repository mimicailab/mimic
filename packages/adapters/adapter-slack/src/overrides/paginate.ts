import type { FastifyRequest } from 'fastify';

/**
 * Slack accepts query params on GET and form-encoded params on POST. Merge
 * both, plus `req.body` (JSON or form), into a flat string-typed map so
 * handlers don't have to care which transport the caller used. Numeric
 * coercion is left to the call site (e.g. `Number(q.limit) || 100`).
 */
export function parseQuery(req: FastifyRequest): Record<string, string> {
  const q = (req.query ?? {}) as Record<string, unknown>;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  for (const [k, v] of Object.entries(b)) {
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

export interface CursorPage<T> {
  page: T[];
  nextCursor: string | null;
}

/**
 * Slack's cursor pagination: opaque `next_cursor` in `response_metadata`. We
 * encode the cursor as `c_${id}` of the last element on the page. An empty
 * string indicates no further pages — Slack's documented sentinel.
 */
export function paginateByCursor<T extends { id?: string; ts?: string }>(
  items: T[],
  cursor: string | undefined,
  limit: number,
): CursorPage<T> {
  const max = Math.min(Math.max(limit | 0, 1), 1000);
  let startIdx = 0;
  if (cursor && cursor.startsWith('c_')) {
    const afterId = cursor.slice(2);
    const idx = items.findIndex((i) => (i.id ?? i.ts) === afterId);
    if (idx >= 0) startIdx = idx + 1;
  }
  const page = items.slice(startIdx, startIdx + max);
  const last = page[page.length - 1];
  const lastKey = last ? (last.id ?? last.ts) : undefined;
  const nextCursor = startIdx + max < items.length && lastKey ? `c_${lastKey}` : null;
  return { page, nextCursor };
}
