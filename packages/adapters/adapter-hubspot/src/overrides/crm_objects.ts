/**
 * Overrides for the unified CRM Objects API:
 *   /crm/objects/<version>/{objectType}                   (GET list, POST create)
 *   /crm/objects/<version>/{objectType}/{objectId}        (GET, PATCH, DELETE)
 *   /crm/objects/<version>/{objectType}/search            (POST)
 *   /crm/objects/<version>/{objectType}/batch/<verb>      (POST)
 *
 * The dynamic `:objectType` path param drives namespacing — records of
 * `contacts` and `deals` live in separate StateStore namespaces so they
 * never collide.
 */

import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { generateId } from '@mimicai/adapter-sdk';
import { defaultHubSpotObject } from '../generated/schemas.js';
import { applySearch, getParam, getQuery, parseBody, projectProperties, send404, sendList } from './_shared.js';
import type { SearchBody } from './_shared.js';

import type { FastifyRequest } from 'fastify';

function nsForObjectType(objectType: string): string {
  return `hubspot:crm_objects:${objectType}`;
}

/**
 * Object type extraction. For routes that use the `:objectType` placeholder
 * we read from `req.params.objectType`. For routes with a literal type (e.g.
 * `/crm/objects/2026-03/contacts/search` from the typed Contacts spec) we
 * fall back to parsing it out of the URL.
 */
function readObjectType(req: FastifyRequest): string {
  const fromParam = ((req.params ?? {}) as Record<string, unknown>).objectType;
  if (typeof fromParam === 'string' && fromParam.length > 0) return fromParam;
  const url = req.url ?? '';
  const m = url.match(/^\/crm\/objects\/[^/]+\/([^/?]+)/);
  return m?.[1] ?? '';
}

/**
 * Object id extraction. Handles both `:objectId` (the unified Objects spec
 * placeholder) and per-type id params like `:ticketId`, `:contactId` from
 * the typed specs.
 */
function readObjectId(req: FastifyRequest): string {
  const params = (req.params ?? {}) as Record<string, unknown>;
  // Try the canonical name first
  if (typeof params.objectId === 'string') return params.objectId;
  // Fall back to any *Id param (ticketId, contactId, dealId, ...)
  for (const k of Object.keys(params)) {
    if (k.endsWith('Id') && k !== 'objectType' && typeof params[k] === 'string') return params[k] as string;
  }
  // Last resort: parse from URL — `/crm/objects/<version>/<type>/<id>`
  const url = (req.url ?? '').split('?')[0]!;
  const m = url.match(/^\/crm\/objects\/[^/]+\/[^/]+\/([^/]+)/);
  return m?.[1] ?? '';
}

/** GET /crm/objects/<version>/:objectType — list records of a dynamic type */
export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    if (!objectType) return send404(reply, 'objectType', '(empty)');
    const q = getQuery(req);
    const items = store.list<Record<string, unknown>>(nsForObjectType(objectType));

    // limit + after cursor pagination
    const limit = Math.min(parseInt(q.limit ?? '10', 10) || 10, 100);
    const after = q.after;
    let startIdx = 0;
    if (after) {
      const idx = items.findIndex((x) => x.id === after);
      if (idx >= 0) startIdx = idx + 1;
    }
    const archivedOnly = q.archived === 'true';
    const filtered = items.filter((x) => Boolean(x.archived) === archivedOnly);
    const page = filtered.slice(startIdx, startIdx + limit).map((item) => projectProperties(item, q));
    const nextAfter = startIdx + limit < filtered.length && page.length > 0
      ? ((page[page.length - 1] as { id?: string }).id ?? null)
      : null;
    return sendList(reply, page, nextAfter);
  };
}

/** POST /crm/objects/<version>/:objectType — create */
export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    if (!objectType) return send404(reply, 'objectType', '(empty)');
    const body = parseBody(req);
    const obj = defaultHubSpotObject({
      id: (body.id as string) ?? generateId('', 18),
      properties: (body.properties as Record<string, unknown>) ?? {},
      associations: (body.associations as unknown[]) ?? undefined,
    });
    store.set(nsForObjectType(objectType), obj.id as string, obj);
    return reply.code(201).send(obj);
  };
}

/** GET /crm/objects/<version>/:objectType/:objectId — retrieve */
export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    const objectId = readObjectId(req);
    const obj = store.get<Record<string, unknown>>(nsForObjectType(objectType), objectId);
    if (!obj) return send404(reply, objectType, objectId);
    return reply.code(200).send(projectProperties(obj, getQuery(req)));
  };
}

/** PATCH /crm/objects/<version>/:objectType/:objectId — update */
export function buildUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    const objectId = readObjectId(req);
    const existing = store.get<Record<string, unknown>>(nsForObjectType(objectType), objectId);
    if (!existing) return send404(reply, objectType, objectId);
    const body = parseBody(req);
    const newProps = (body.properties as Record<string, unknown>) ?? {};
    const updated = {
      ...existing,
      properties: { ...(existing.properties as Record<string, unknown>), ...newProps },
      updatedAt: new Date().toISOString(),
    };
    store.set(nsForObjectType(objectType), objectId, updated);
    return reply.code(200).send(updated);
  };
}

/** DELETE /crm/objects/<version>/:objectType/:objectId — archive */
export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    const objectId = readObjectId(req);
    const existing = store.get<Record<string, unknown>>(nsForObjectType(objectType), objectId);
    if (!existing) return send404(reply, objectType, objectId);
    store.set(nsForObjectType(objectType), objectId, { ...existing, archived: true, updatedAt: new Date().toISOString() });
    return reply.code(204).send();
  };
}

/** POST /crm/objects/<version>/:objectType/search — filterGroups search */
export function buildSearchHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    const body = parseBody(req) as SearchBody;
    const items = store.list<Record<string, unknown>>(nsForObjectType(objectType));
    const matched = applySearch(items, body);
    const limit = Math.min(body.limit ?? 10, 100);
    const after = body.after;
    let startIdx = 0;
    if (after) {
      const idx = matched.findIndex((x) => (x as { id?: string }).id === after);
      if (idx >= 0) startIdx = idx + 1;
    }
    const page = matched.slice(startIdx, startIdx + limit);
    const nextAfter = startIdx + limit < matched.length && page.length > 0
      ? ((page[page.length - 1] as { id?: string }).id ?? null)
      : null;
    return sendList(reply, page, nextAfter);
  };
}

// ---------------------------------------------------------------------------
// Batch operations under /crm/objects/<version>/:objectType/batch/<verb>
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString();
const env = (results: unknown[], extras: Record<string, unknown> = {}) => ({
  status: 'COMPLETE',
  results,
  startedAt: now(),
  completedAt: now(),
  ...extras,
});

export function buildBatchCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    const body = parseBody(req);
    const inputs = (body.inputs as Array<Record<string, unknown>> | undefined) ?? [];
    const results: unknown[] = [];
    for (const input of inputs) {
      const obj = defaultHubSpotObject({
        id: (input.id as string) ?? generateId('', 18),
        properties: (input.properties as Record<string, unknown>) ?? {},
        associations: (input.associations as unknown[]) ?? undefined,
      });
      store.set(nsForObjectType(objectType), obj.id as string, obj);
      results.push(obj);
    }
    return reply.code(201).send(env(results));
  };
}

export function buildBatchReadHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    const body = parseBody(req);
    const inputs = (body.inputs as Array<{ id: string }> | undefined) ?? [];
    const results: unknown[] = [];
    const errors: Array<Record<string, unknown>> = [];
    for (const input of inputs) {
      const obj = store.get<Record<string, unknown>>(nsForObjectType(objectType), input.id);
      if (obj) results.push(obj);
      else errors.push({ status: 'error', category: 'OBJECT_NOT_FOUND', message: `Unable to find ${objectType} with id "${input.id}"` });
    }
    return reply.code(200).send(env(results, errors.length > 0 ? { numErrors: errors.length, errors } : {}));
  };
}

export function buildBatchUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    const body = parseBody(req);
    const inputs = (body.inputs as Array<{ id: string; properties: Record<string, unknown> }> | undefined) ?? [];
    const results: unknown[] = [];
    const errors: Array<Record<string, unknown>> = [];
    for (const input of inputs) {
      const existing = store.get<Record<string, unknown>>(nsForObjectType(objectType), input.id);
      if (!existing) {
        errors.push({ status: 'error', category: 'OBJECT_NOT_FOUND', message: `Unable to find ${objectType} with id "${input.id}"` });
        continue;
      }
      const updated = {
        ...existing,
        properties: { ...(existing.properties as Record<string, unknown>), ...input.properties },
        updatedAt: now(),
      };
      store.set(nsForObjectType(objectType), input.id, updated);
      results.push(updated);
    }
    return reply.code(200).send(env(results, errors.length > 0 ? { numErrors: errors.length, errors } : {}));
  };
}

export function buildBatchUpsertHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    const body = parseBody(req);
    const inputs = (body.inputs as Array<{ id?: string; idProperty?: string; properties: Record<string, unknown> }> | undefined) ?? [];
    const results: unknown[] = [];
    for (const input of inputs) {
      let existing: Record<string, unknown> | undefined;
      if (input.idProperty && input.properties[input.idProperty] !== undefined) {
        const matchValue = input.properties[input.idProperty];
        existing = store
          .list<Record<string, unknown>>(nsForObjectType(objectType))
          .find((item) => (item.properties as Record<string, unknown> | undefined)?.[input.idProperty!] === matchValue);
      } else if (input.id) {
        existing = store.get<Record<string, unknown>>(nsForObjectType(objectType), input.id);
      }
      if (existing) {
        const updated = {
          ...existing,
          properties: { ...(existing.properties as Record<string, unknown>), ...input.properties },
          updatedAt: now(),
        };
        store.set(nsForObjectType(objectType), existing.id as string, updated);
        results.push(updated);
      } else {
        const obj = defaultHubSpotObject({
          id: input.id ?? generateId('', 18),
          properties: input.properties,
        });
        store.set(nsForObjectType(objectType), obj.id as string, obj);
        results.push(obj);
      }
    }
    return reply.code(200).send(env(results));
  };
}

export function buildBatchArchiveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = readObjectType(req);
    const body = parseBody(req);
    const inputs = (body.inputs as Array<{ id: string }> | undefined) ?? [];
    for (const input of inputs) {
      const existing = store.get<Record<string, unknown>>(nsForObjectType(objectType), input.id);
      if (existing) {
        store.set(nsForObjectType(objectType), input.id, { ...existing, archived: true, updatedAt: now() });
      }
    }
    return reply.code(204).send();
  };
}
