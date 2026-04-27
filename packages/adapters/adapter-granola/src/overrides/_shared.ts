/**
 * Shared utilities for Granola override handlers.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { granolaBadRequest, granolaNotFound } from '../granola-errors.js';

export const NS = {
  notes: 'granola:notes',
  folders: 'granola:folders',
} as const;

export function getParam(req: FastifyRequest, name: string): string {
  const params = (req.params ?? {}) as Record<string, unknown>;
  return String(params[name] ?? '');
}

export function getQuery(req: FastifyRequest): Record<string, string> {
  return (req.query ?? {}) as Record<string, string>;
}

export function send404(reply: FastifyReply, resource: string, id: string) {
  return reply.code(404).send(granolaNotFound(resource, id));
}

export function send400(reply: FastifyReply, message: string, code?: string) {
  return reply.code(400).send(granolaBadRequest(message, code));
}

/**
 * Cursor-based pagination over a sorted list. Returns `{ page, hasMore, nextCursor }`.
 *
 * The cursor is the id of the last item on the previous page. `hasMore` is
 * true iff there are more items after the page returned.
 */
export function paginateByCursor<T extends { id: string }>(
  items: T[],
  cursor: string | undefined,
  pageSize: number,
): { page: T[]; hasMore: boolean; nextCursor: string | null } {
  let startIdx = 0;
  if (cursor) {
    const idx = items.findIndex((x) => x.id === cursor);
    if (idx >= 0) startIdx = idx + 1;
  }
  const page = items.slice(startIdx, startIdx + pageSize);
  const hasMore = startIdx + pageSize < items.length;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;
  return { page, hasMore, nextCursor };
}

/**
 * Parse Granola's date filter params (`created_before`, `created_after`,
 * `updated_after`). Returns null on invalid ISO 8601.
 */
export function parseIsoDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
