/**
 * Shared utilities for HubSpot override handlers.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { hubspotBadRequest, hubspotNotFound, hubspotValidation } from '../hubspot-errors.js';

/** Base namespace for HubSpot StateStore. Resource names hang off this. */
export function nsFor(resource: string, ...extras: string[]): string {
  if (extras.length === 0) return `hubspot:${resource}`;
  return `hubspot:${resource}:${extras.join(':')}`;
}

export function getParam(req: FastifyRequest, name: string): string {
  const params = (req.params ?? {}) as Record<string, unknown>;
  return String(params[name] ?? '');
}

export function getQuery(req: FastifyRequest): Record<string, string> {
  return (req.query ?? {}) as Record<string, string>;
}

export function parseBody(req: FastifyRequest): Record<string, unknown> {
  const body = req.body;
  if (body === null || body === undefined || typeof body !== 'object') return {};
  return body as Record<string, unknown>;
}

export function send404(reply: FastifyReply, resource: string, id: string) {
  return reply.code(404).send(hubspotNotFound(resource, id));
}

export function send400(reply: FastifyReply, message: string, errors?: Array<{ message: string; in?: string; code?: string }>) {
  return reply.code(400).send(hubspotBadRequest(message, errors));
}

export function sendValidation(reply: FastifyReply, message: string, errors?: Array<{ message: string; in?: string; code?: string }>) {
  return reply.code(400).send(hubspotValidation(message, errors));
}

/** HubSpot list envelope: `{ results: [...], paging?: { next?: { after, link? } } }`. */
export function sendList(reply: FastifyReply, results: unknown[], nextAfter: string | null = null) {
  const body: { results: unknown[]; paging?: { next: { after: string; link?: string } } } = { results };
  if (nextAfter) body.paging = { next: { after: nextAfter } };
  return reply.code(200).send(body);
}

/**
 * Cursor pagination over a sorted list. HubSpot's pattern:
 *   - `limit` query param (default 10, max 100)
 *   - `after` query param contains the id of the last item on the previous page
 *   - response `paging.next.after` set when more results exist
 */
export function paginateAfter<T extends { id?: string; listId?: string }>(
  items: T[],
  query: Record<string, string>,
): { page: T[]; nextAfter: string | null } {
  const limit = Math.min(parseInt(query.limit ?? '10', 10) || 10, 100);
  const after = query.after;
  let startIdx = 0;
  if (after) {
    const idx = items.findIndex((x) => (x.id ?? x.listId) === after);
    if (idx >= 0) startIdx = idx + 1;
  }
  const page = items.slice(startIdx, startIdx + limit);
  const nextAfter = startIdx + limit < items.length && page.length > 0
    ? ((page[page.length - 1] as { id?: string; listId?: string }).id ?? (page[page.length - 1] as { listId?: string }).listId ?? null)
    : null;
  return { page, nextAfter };
}

/**
 * Apply HubSpot's POST /search filterGroups/filters to a list of records.
 *
 * Supported operators (HubSpot search subset):
 *   EQ, NEQ, LT, LTE, GT, GTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY,
 *   CONTAINS_TOKEN, NOT_CONTAINS_TOKEN
 *
 * filterGroups are OR'd together; filters within a group are AND'd.
 */
export interface SearchFilter {
  propertyName: string;
  operator: string;
  value?: unknown;
  values?: unknown[];
  highValue?: unknown;
}

export interface SearchBody {
  filterGroups?: Array<{ filters: SearchFilter[] }>;
  query?: string;
  sorts?: Array<string | { propertyName: string; direction: 'ASCENDING' | 'DESCENDING' }>;
  properties?: string[];
  limit?: number;
  after?: string;
}

export function applySearch(items: Record<string, unknown>[], body: SearchBody): Record<string, unknown>[] {
  let result = items;

  if (body.filterGroups && body.filterGroups.length > 0) {
    result = result.filter((item) => {
      // Any group matching = match (OR across groups)
      return body.filterGroups!.some((group) => {
        // All filters in the group must match (AND within group)
        return group.filters.every((f) => matchesFilter(item, f));
      });
    });
  }

  if (body.query && body.query.trim() !== '') {
    const q = body.query.toLowerCase();
    result = result.filter((item) => flatString(item).toLowerCase().includes(q));
  }

  if (body.sorts && body.sorts.length > 0) {
    const sorts = body.sorts.map((s) =>
      typeof s === 'string' ? { propertyName: s, direction: 'ASCENDING' as const } : s,
    );
    result = [...result].sort((a, b) => {
      for (const s of sorts) {
        const av = readProperty(a, s.propertyName);
        const bv = readProperty(b, s.propertyName);
        if (av === bv) continue;
        const dir = s.direction === 'DESCENDING' ? -1 : 1;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return ((av as number | string) > (bv as number | string) ? 1 : -1) * dir;
      }
      return 0;
    });
  }

  return result;
}

function matchesFilter(item: Record<string, unknown>, f: SearchFilter): boolean {
  const value = readProperty(item, f.propertyName);
  switch (f.operator) {
    case 'EQ':
      return String(value) === String(f.value);
    case 'NEQ':
      return String(value) !== String(f.value);
    case 'LT':
      return Number(value) < Number(f.value);
    case 'LTE':
      return Number(value) <= Number(f.value);
    case 'GT':
      return Number(value) > Number(f.value);
    case 'GTE':
      return Number(value) >= Number(f.value);
    case 'BETWEEN':
      return Number(value) >= Number(f.value) && Number(value) <= Number(f.highValue);
    case 'IN':
      return (f.values ?? []).map(String).includes(String(value));
    case 'NOT_IN':
      return !(f.values ?? []).map(String).includes(String(value));
    case 'HAS_PROPERTY':
      return value !== undefined && value !== null && value !== '';
    case 'NOT_HAS_PROPERTY':
      return value === undefined || value === null || value === '';
    case 'CONTAINS_TOKEN':
      return typeof value === 'string' && value.toLowerCase().includes(String(f.value).toLowerCase());
    case 'NOT_CONTAINS_TOKEN':
      return typeof value === 'string' && !value.toLowerCase().includes(String(f.value).toLowerCase());
    default:
      // Unsupported operator — permissive (matches everything) so the mock
      // doesn't crash on filters we haven't implemented.
      return true;
  }
}

/** Read a property value out of a HubSpot CRM object: top-level first, then `properties.<name>`. */
function readProperty(item: Record<string, unknown>, name: string): unknown {
  if (name in item) return (item as Record<string, unknown>)[name];
  const props = item.properties as Record<string, unknown> | undefined;
  if (props && name in props) return props[name];
  return undefined;
}

function flatString(obj: unknown): string {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) return obj.map(flatString).join(' ');
  if (typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).map(flatString).join(' ');
  }
  return '';
}

/** Extract the dynamic `objectType` value from a CRM Objects URL (`/crm/objects/2026-03/{objectType}/...`). */
export function objectTypeFromRequest(req: FastifyRequest): string {
  const params = (req.params ?? {}) as Record<string, unknown>;
  if (typeof params.objectType === 'string') return params.objectType;
  return '';
}

/** Filter a property bag down to the `properties` query param (comma-separated). */
export function projectProperties(item: Record<string, unknown>, query: Record<string, string>): Record<string, unknown> {
  const projection = query.properties;
  if (!projection) return item;
  const wanted = new Set(projection.split(',').map((s) => s.trim()).filter(Boolean));
  if (wanted.size === 0) return item;
  const props = (item.properties as Record<string, unknown> | undefined) ?? {};
  const filtered: Record<string, unknown> = {};
  for (const k of wanted) if (k in props) filtered[k] = props[k];
  return { ...item, properties: filtered };
}
