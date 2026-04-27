/**
 * Shared utilities for Attio override handlers.
 *
 * Attio is a meta-CRM where almost every resource has a compound id and
 * dynamic namespacing (records of `people` vs `companies` live in separate
 * StateStore namespaces, etc.). These helpers keep handler code small.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/adapter-sdk';
import { DEFAULT_WORKSPACE_ID } from '../generated/schemas.js';
import { attioInvalidRequest, attioNotFound } from '../attio-errors.js';

export { DEFAULT_WORKSPACE_ID };

export const NS = {
  self: 'attio:self',
  objects: 'attio:objects',
  objectViews: (object: string) => `attio:object_views:${object}`,
  records: (object: string) => `attio:records:${object}`,
  recordEntries: (object: string, recordId: string) => `attio:record_entries:${object}:${recordId}`,
  lists: 'attio:lists',
  listViews: (list: string) => `attio:list_views:${list}`,
  listEntries: (list: string) => `attio:list_entries:${list}`,
  attributes: (target: string, identifier: string) => `attio:attributes:${target}:${identifier}`,
  selectOptions: (target: string, identifier: string, attribute: string) => `attio:select_options:${target}:${identifier}:${attribute}`,
  statuses: (target: string, identifier: string, attribute: string) => `attio:statuses:${target}:${identifier}:${attribute}`,
  notes: 'attio:notes',
  tasks: 'attio:tasks',
  threads: 'attio:threads',
  comments: 'attio:comments',
  meetings: 'attio:meetings',
  callRecordings: (meetingId: string) => `attio:call_recordings:${meetingId}`,
  files: 'attio:files',
  webhooks: 'attio:webhooks',
  workspaceMembers: 'attio:workspace_members',
  scimUsers: 'attio:scim_users',
  scimGroups: 'attio:scim_groups',
  scimSchemas: 'attio:scim_schemas',
} as const;

/** Generate a UUID-shaped string deterministically (same algorithm as the codegen factories). */
export function uuid(): string {
  const hex = generateId('', 32).replace(/[^a-f0-9]/gi, '0').padEnd(32, '0').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    '8' + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseBody(req: FastifyRequest): Record<string, unknown> {
  const body = req.body;
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object') return {};
  return body as Record<string, unknown>;
}

export function getParam(req: FastifyRequest, name: string): string {
  const params = (req.params ?? {}) as Record<string, unknown>;
  return String(params[name] ?? '');
}

export function getQuery(req: FastifyRequest): Record<string, string> {
  return (req.query ?? {}) as Record<string, string>;
}

/**
 * Apply Attio's POST `*​/query` body filters to a list of items.
 *
 * Attio's filter language is rich (https://developers.attio.com/reference/filtering)
 * — we support the common subset:
 *   - flat equality:        `{ filter: { name: "Ada" } }`           (top-level field equals)
 *   - typed equality:       `{ filter: { email: { eq: "x@y.z" } } }`
 *   - $or / $and:           `{ filter: { $or: [...] } }`
 *   - sorts:                `{ sorts: [{ attribute: "...", direction: "asc" }] }`
 *   - limit / offset:       integers
 *
 * Anything more exotic is treated as a no-op match (returns all items),
 * which keeps the mock permissive for tests that don't care about filters.
 */
export interface QueryBody {
  filter?: Record<string, unknown>;
  sorts?: Array<{ attribute: string; direction?: 'asc' | 'desc'; field?: string }>;
  limit?: number;
  offset?: number;
}

export function applyFilter(items: Record<string, unknown>[], filter: unknown): Record<string, unknown>[] {
  if (!filter || typeof filter !== 'object') return items;
  const f = filter as Record<string, unknown>;

  if (Array.isArray(f.$or)) {
    const branches = f.$or as unknown[];
    const matched = new Set<Record<string, unknown>>();
    for (const branch of branches) {
      for (const item of applyFilter(items, branch)) matched.add(item);
    }
    return [...matched];
  }
  if (Array.isArray(f.$and)) {
    let result = items;
    for (const branch of f.$and as unknown[]) {
      result = applyFilter(result, branch);
    }
    return result;
  }

  return items.filter((item) => {
    for (const [key, predicate] of Object.entries(f)) {
      if (key.startsWith('$')) continue;
      if (!matchesField(item, key, predicate)) return false;
    }
    return true;
  });
}

function matchesField(item: Record<string, unknown>, key: string, predicate: unknown): boolean {
  // values is the canonical place attio puts attribute values: `record.values.email_addresses[].email_address`
  const values = (item.values ?? {}) as Record<string, unknown>;
  const valueArr = (values[key] ?? []) as Array<Record<string, unknown>>;

  // Pull a comparable scalar from the value array (typed values come as
  // arrays of objects keyed by `value`, `email_address`, `phone_number`, etc.).
  const candidates: unknown[] = [];
  if (item[key] !== undefined) candidates.push(item[key]);
  for (const v of Array.isArray(valueArr) ? valueArr : []) {
    if (v == null || typeof v !== 'object') {
      candidates.push(v);
      continue;
    }
    const vo = v as Record<string, unknown>;
    for (const fname of ['value', 'email_address', 'phone_number', 'domain', 'full_name', 'option_id', 'status_id', 'workspace_member_id']) {
      if (vo[fname] !== undefined) candidates.push(vo[fname]);
    }
  }

  if (typeof predicate === 'object' && predicate !== null) {
    const p = predicate as Record<string, unknown>;
    if ('eq' in p) return candidates.some((c) => c === p.eq);
    if ('not_eq' in p) return !candidates.some((c) => c === p.not_eq);
    if ('contains' in p) return candidates.some((c) => typeof c === 'string' && c.includes(String(p.contains)));
    if ('not_contains' in p) return !candidates.some((c) => typeof c === 'string' && c.includes(String(p.not_contains)));
    if ('starts_with' in p) return candidates.some((c) => typeof c === 'string' && c.startsWith(String(p.starts_with)));
    if ('ends_with' in p) return candidates.some((c) => typeof c === 'string' && c.endsWith(String(p.ends_with)));
    if ('in' in p && Array.isArray(p.in)) return candidates.some((c) => (p.in as unknown[]).includes(c));
    if ('greater_than' in p) return candidates.some((c) => typeof c === 'number' && c > (p.greater_than as number));
    if ('less_than' in p) return candidates.some((c) => typeof c === 'number' && c < (p.less_than as number));
    if ('is_empty' in p && p.is_empty) return candidates.length === 0;
    if ('is_not_empty' in p && p.is_not_empty) return candidates.length > 0;
    return true; // unsupported operator — permissive
  }

  // scalar predicate => equality
  return candidates.some((c) => c === predicate);
}

export function applySorts<T extends Record<string, unknown>>(
  items: T[],
  sorts: QueryBody['sorts'],
): T[] {
  if (!Array.isArray(sorts) || sorts.length === 0) return items;
  const sorted = [...items];
  sorted.sort((a, b) => {
    for (const sort of sorts) {
      const dir = sort.direction === 'desc' ? -1 : 1;
      const av = a[sort.attribute];
      const bv = b[sort.attribute];
      if (av === bv) continue;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return ((av as number | string) > (bv as number | string) ? 1 : -1) * dir;
    }
    return 0;
  });
  return sorted;
}

export function applyLimitOffset<T>(items: T[], limit?: number, offset?: number): T[] {
  const o = Math.max(offset ?? 0, 0);
  const l = Math.min(limit ?? 500, 1000);
  return items.slice(o, o + l);
}

/** Sends a 404 with Attio's flat error envelope. Caller should `return` the result. */
export function send404(reply: FastifyReply, resource: string, id: string) {
  return reply.code(404).send(attioNotFound(resource, id));
}

/** Sends a 400 invalid_request_error with optional `field`. */
export function send400(reply: FastifyReply, message: string, field?: string) {
  return reply.code(400).send(attioInvalidRequest(message, field));
}

/** Send `{ data: <payload> }` with the given status code (default 200). */
export function sendData(reply: FastifyReply, payload: unknown, code = 200) {
  return reply.code(code).send({ data: payload });
}

/** Send a SCIM list envelope `{ schemas, totalResults, startIndex, itemsPerPage, Resources }`. */
export function sendScimList(reply: FastifyReply, resources: unknown[]) {
  return reply.code(200).send({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  });
}

/**
 * Compose Attio's compound id given the optional `data.id` from a request body
 * plus a fallback resource id key. Always populates `workspace_id`.
 */
export function buildId(
  partial: Partial<Record<string, string>> | undefined,
  resourceIdKey: string,
  extras: Record<string, string> = {},
): Record<string, string> {
  return {
    workspace_id: partial?.workspace_id ?? DEFAULT_WORKSPACE_ID,
    ...extras,
    [resourceIdKey]: partial?.[resourceIdKey] ?? uuid(),
  };
}
