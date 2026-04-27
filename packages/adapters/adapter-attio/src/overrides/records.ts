/**
 * Records — the heart of Attio's data model.
 *
 * Records belong to a dynamic `{object}` (people, companies, deals, etc.).
 * Each route reads/writes the StateStore namespace `attio:records:{object}`,
 * so people and companies live in completely separate buckets.
 *
 * Attio's filter language is rich; the matchers in `_shared.applyFilter`
 * cover the common subset (eq, contains, in, $or, $and, plus implicit
 * traversal of `record.values.<attr>[].{value|email_address|...}`).
 */

import type { FastifyRequest } from 'fastify';
import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultRecord } from '../generated/schemas.js';
import {
  NS,
  applyFilter,
  applyLimitOffset,
  applySorts,
  buildId,
  getParam,
  nowIso,
  parseBody,
  send400,
  send404,
  sendData,
  uuid,
} from './_shared.js';
import type { QueryBody } from './_shared.js';

function objectIdFromRequest(req: FastifyRequest): string {
  return getParam(req, 'object');
}

function recordIdFromRequest(req: FastifyRequest): string {
  return getParam(req, 'record_id');
}

function findRecord(store: StateStore, object: string, recordId: string): Record<string, unknown> | undefined {
  return store.get<Record<string, unknown>>(NS.records(object), recordId);
}

function ensureObjectExists(store: StateStore, object: string): boolean {
  return store.get(NS.objects, object) !== undefined;
}

/** Compute the object's UUID; for unknown slugs, deterministically derive one. */
function resolveObjectId(store: StateStore, slug: string): string {
  const obj = store.get<Record<string, unknown>>(NS.objects, slug);
  if (obj && typeof obj.id === 'object' && obj.id) {
    const id = obj.id as Record<string, string>;
    return id.object_id ?? uuid();
  }
  return uuid();
}

// ---------------------------------------------------------------------------
// POST /v2/objects/:object/records/query
// ---------------------------------------------------------------------------

export function buildQueryHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const object = objectIdFromRequest(req);
    const body = parseBody(req) as QueryBody;

    const items = store.list<Record<string, unknown>>(NS.records(object));
    let result = items;
    if (body.filter) result = applyFilter(result, body.filter);
    result = applySorts(result, body.sorts);
    const paged = applyLimitOffset(result, body.limit, body.offset);

    return sendData(reply, paged);
  };
}

// ---------------------------------------------------------------------------
// POST /v2/objects/:object/records — Create
// ---------------------------------------------------------------------------

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const object = objectIdFromRequest(req);
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;

    const objectId = resolveObjectId(store, object);
    const id = buildId(data.id as Record<string, string> | undefined, 'record_id', { object_id: objectId });

    const record = defaultRecord({
      id,
      created_at: nowIso(),
      values: (data.values as Record<string, unknown>) ?? {},
      web_url: `https://app.attio.com/mimic/${object}/${id.record_id}`,
    });
    store.set(NS.records(object), id.record_id!, record);
    return sendData(reply, record);
  };
}

// ---------------------------------------------------------------------------
// PUT /v2/objects/:object/records — Assert (upsert by matching attribute)
// ---------------------------------------------------------------------------

export function buildAssertHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const object = objectIdFromRequest(req);
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const matchingAttribute = (body.matching_attribute as string) ?? 'email_addresses';

    const allRecords = store.list<Record<string, unknown>>(NS.records(object));
    const inputValues = (data.values as Record<string, unknown> | undefined) ?? {};
    const matchValues = (inputValues[matchingAttribute] ?? []) as Array<Record<string, unknown>>;

    let existing: Record<string, unknown> | undefined;
    for (const r of allRecords) {
      const rv = (r.values as Record<string, unknown> | undefined) ?? {};
      const rArr = (rv[matchingAttribute] ?? []) as Array<Record<string, unknown>>;
      if (rArr.some((mv) => matchValues.some((iv) => valuesIntersect(mv, iv)))) {
        existing = r;
        break;
      }
    }

    if (existing) {
      const id = existing.id as Record<string, string>;
      const merged = mergeValues(existing, inputValues, /*append*/ true);
      store.set(NS.records(object), id.record_id!, merged);
      return sendData(reply, merged);
    }

    const objectId = resolveObjectId(store, object);
    const newId = buildId(undefined, 'record_id', { object_id: objectId });
    const record = defaultRecord({
      id: newId,
      created_at: nowIso(),
      values: inputValues,
      web_url: `https://app.attio.com/mimic/${object}/${newId.record_id}`,
    });
    store.set(NS.records(object), newId.record_id!, record);
    return sendData(reply, record);
  };
}

function valuesIntersect(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const key of ['value', 'email_address', 'phone_number', 'domain', 'workspace_member_id', 'option_id', 'status_id']) {
    if (a[key] !== undefined && a[key] === b[key]) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// GET /v2/objects/:object/records/:record_id — Retrieve
// ---------------------------------------------------------------------------

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const object = objectIdFromRequest(req);
    const recordId = recordIdFromRequest(req);
    if (!ensureObjectExists(store, object) && !object) {
      return send400(reply, 'object slug is required', 'object');
    }
    const record = findRecord(store, object, recordId);
    if (!record) return send404(reply, 'Record', recordId);
    return sendData(reply, record);
  };
}

// ---------------------------------------------------------------------------
// PATCH /v2/objects/:object/records/:record_id — Update (append multiselect)
// PUT   /v2/objects/:object/records/:record_id — Update (overwrite multiselect)
// ---------------------------------------------------------------------------

export function buildUpdateAppendHandler(store: StateStore): OverrideHandler {
  return buildUpdate(store, /*append*/ true);
}

export function buildUpdateOverwriteHandler(store: StateStore): OverrideHandler {
  return buildUpdate(store, /*append*/ false);
}

function buildUpdate(store: StateStore, append: boolean): OverrideHandler {
  return async (req, reply) => {
    const object = objectIdFromRequest(req);
    const recordId = recordIdFromRequest(req);
    const existing = findRecord(store, object, recordId);
    if (!existing) return send404(reply, 'Record', recordId);

    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const incoming = (data.values as Record<string, unknown>) ?? {};
    const merged = mergeValues(existing, incoming, append);
    store.set(NS.records(object), recordId, merged);
    return sendData(reply, merged);
  };
}

function mergeValues(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  append: boolean,
): Record<string, unknown> {
  const existingValues = (existing.values as Record<string, unknown> | undefined) ?? {};
  const merged: Record<string, unknown> = { ...existingValues };
  for (const [key, value] of Object.entries(incoming)) {
    if (append && Array.isArray(value) && Array.isArray(merged[key])) {
      merged[key] = [...(merged[key] as unknown[]), ...value];
    } else {
      merged[key] = Array.isArray(value) ? value : [value];
    }
  }
  return { ...existing, values: merged };
}

// ---------------------------------------------------------------------------
// DELETE /v2/objects/:object/records/:record_id
// ---------------------------------------------------------------------------

export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const object = objectIdFromRequest(req);
    const recordId = recordIdFromRequest(req);
    if (!findRecord(store, object, recordId)) return send404(reply, 'Record', recordId);
    store.delete(NS.records(object), recordId);
    return reply.code(200).send({});
  };
}

// ---------------------------------------------------------------------------
// GET /v2/objects/:object/records/:record_id/attributes/:attribute/values
// ---------------------------------------------------------------------------

export function buildListAttributeValuesHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const object = objectIdFromRequest(req);
    const recordId = recordIdFromRequest(req);
    const attribute = getParam(req, 'attribute');
    const record = findRecord(store, object, recordId);
    if (!record) return send404(reply, 'Record', recordId);
    const values = (record.values as Record<string, unknown> | undefined) ?? {};
    const arr = (values[attribute] ?? []) as unknown[];
    return sendData(reply, arr);
  };
}

// ---------------------------------------------------------------------------
// GET /v2/objects/:object/records/:record_id/entries — Activity timeline
// ---------------------------------------------------------------------------

export function buildListEntriesHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const object = objectIdFromRequest(req);
    const recordId = recordIdFromRequest(req);
    const entries = store.list<Record<string, unknown>>(NS.recordEntries(object, recordId));
    return sendData(reply, entries);
  };
}

// ---------------------------------------------------------------------------
// POST /v2/objects/records/search — Global record search
// ---------------------------------------------------------------------------

export function buildSearchHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const query = ((body.query as string) ?? '').toLowerCase().trim();
    const objectSlugs = ((body.objects as string[] | undefined) ?? store.list<Record<string, unknown>>(NS.objects).map((o) => o.api_slug as string));

    const matches: Record<string, unknown>[] = [];
    for (const slug of objectSlugs) {
      const items = store.list<Record<string, unknown>>(NS.records(slug));
      for (const r of items) {
        if (!query || flatString(r).toLowerCase().includes(query)) {
          matches.push({ ...r, object: slug });
        }
      }
    }

    const limit = (body.limit as number | undefined) ?? 25;
    return sendData(reply, matches.slice(0, limit));
  };
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
