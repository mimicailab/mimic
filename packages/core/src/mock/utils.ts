import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a prefixed ID (e.g. `cus_abc123`, `pi_x7k9m2`).
 *
 * @param prefix - The prefix before the underscore (e.g. 'cus', 'pi', 'sub')
 * @param length - Number of random characters after the prefix (default: 14)
 */
export function generateId(prefix: string, length: number = 14): string {
  const chars = randomBytes(Math.ceil(length * 0.75))
    .toString('base64url')
    .slice(0, length)
    .toLowerCase();
  return `${prefix}_${chars}`;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
  totalCount: number;
}

/**
 * Paginate an array of items using cursor-based pagination.
 *
 * The cursor is the stringified index of the item to start after.
 *
 * @param items - Full list of items
 * @param cursor - Opaque cursor (stringified index). Omit for first page.
 * @param limit - Max items per page (default: 10, max: 100)
 */
export function paginate<T>(
  items: T[],
  cursor?: string,
  limit: number = 10,
): PaginatedResult<T> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const startIndex = cursor ? parseInt(cursor, 10) + 1 : 0;

  if (isNaN(startIndex) || startIndex < 0) {
    return { data: [], hasMore: false, totalCount: items.length };
  }

  const page = items.slice(startIndex, startIndex + safeLimit);
  const endIndex = startIndex + page.length - 1;
  const hasMore = startIndex + safeLimit < items.length;

  return {
    data: page,
    hasMore,
    nextCursor: hasMore ? String(endIndex) : undefined,
    totalCount: items.length,
  };
}

// ---------------------------------------------------------------------------
// Date filtering
// ---------------------------------------------------------------------------

/**
 * Filter items by a date field, returning only those within [start, end].
 *
 * @param items - Array of objects to filter
 * @param field - Property name containing the date value (ISO string or Date)
 * @param start - Inclusive start date (ISO string). Omit for no lower bound.
 * @param end - Inclusive end date (ISO string). Omit for no upper bound.
 */
export function filterByDate<T extends Record<string, unknown>>(
  items: T[],
  field: string,
  start?: string,
  end?: string,
): T[] {
  const startTime = start ? new Date(start).getTime() : -Infinity;
  const endTime = end ? new Date(end).getTime() : Infinity;

  if (isNaN(startTime) || isNaN(endTime)) {
    return items;
  }

  return items.filter((item) => {
    const raw = item[field];
    if (raw === null || raw === undefined) return false;

    const itemTime =
      raw instanceof Date ? raw.getTime() : new Date(String(raw)).getTime();

    if (isNaN(itemTime)) return false;
    return itemTime >= startTime && itemTime <= endTime;
  });
}

// ---------------------------------------------------------------------------
// Persona resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a persona ID from a Bearer token in the Authorization header.
 *
 * Convention: the token IS the persona ID (e.g. `Bearer young-professional`).
 * This keeps mock auth simple while still enabling multi-persona routing.
 *
 * @param authHeader - The raw Authorization header value
 */
export function resolvePersonaFromBearer(authHeader?: string): string | null {
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) return null;

  return match[1].trim() || null;
}

/**
 * Resolve a persona ID from a field in the request body.
 *
 * @param body - Parsed request body object
 * @param field - Field name to extract the persona ID from
 */
export function resolvePersonaFromBody(
  body: Record<string, unknown>,
  field: string,
): string | null {
  if (!body || typeof body !== 'object') return null;

  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) return null;

  return value;
}
