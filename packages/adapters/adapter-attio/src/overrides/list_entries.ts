import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultListEntry } from '../generated/schemas.js';
import {
  NS,
  applyFilter,
  applyLimitOffset,
  applySorts,
  buildId,
  getParam,
  nowIso,
  parseBody,
  send404,
  sendData,
} from './_shared.js';
import type { QueryBody } from './_shared.js';

function listIdFromRequest(req: Parameters<OverrideHandler>[0]): string {
  return getParam(req, 'list');
}

export function buildQueryHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const list = listIdFromRequest(req);
    const body = parseBody(req) as QueryBody;
    let items = store.list<Record<string, unknown>>(NS.listEntries(list));
    if (body.filter) items = applyFilter(items, body.filter);
    items = applySorts(items, body.sorts);
    const paged = applyLimitOffset(items, body.limit, body.offset);
    return sendData(reply, paged);
  };
}

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const list = listIdFromRequest(req);
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'entry_id', { list_id: list });
    const entry = defaultListEntry({
      id,
      parent_record_id: (data.parent_record_id as string) ?? '',
      parent_object: (data.parent_object as string) ?? '',
      created_at: nowIso(),
      entry_values: (data.entry_values as Record<string, unknown>) ?? {},
    });
    store.set(NS.listEntries(list), id.entry_id!, entry);
    return sendData(reply, entry);
  };
}

export function buildAssertHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const list = listIdFromRequest(req);
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const matchingAttribute = (body.matching_attribute as string) ?? 'parent_record_id';
    const items = store.list<Record<string, unknown>>(NS.listEntries(list));
    const matchValue = data[matchingAttribute];

    const existing = items.find((e) => e[matchingAttribute] === matchValue);
    if (existing) {
      const updated = { ...existing, ...data };
      const id = existing.id as Record<string, string>;
      store.set(NS.listEntries(list), id.entry_id!, updated);
      return sendData(reply, updated);
    }

    const id = buildId(undefined, 'entry_id', { list_id: list });
    const entry = defaultListEntry({
      id,
      parent_record_id: (data.parent_record_id as string) ?? '',
      parent_object: (data.parent_object as string) ?? '',
      created_at: nowIso(),
      entry_values: (data.entry_values as Record<string, unknown>) ?? {},
    });
    store.set(NS.listEntries(list), id.entry_id!, entry);
    return sendData(reply, entry);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const list = listIdFromRequest(req);
    const entryId = getParam(req, 'entry_id');
    const entry = store.get<Record<string, unknown>>(NS.listEntries(list), entryId);
    if (!entry) return send404(reply, 'List entry', entryId);
    return sendData(reply, entry);
  };
}

export function buildUpdateAppendHandler(store: StateStore): OverrideHandler {
  return buildUpdate(store, /*append*/ true);
}

export function buildUpdateOverwriteHandler(store: StateStore): OverrideHandler {
  return buildUpdate(store, /*append*/ false);
}

function buildUpdate(store: StateStore, append: boolean): OverrideHandler {
  return async (req, reply) => {
    const list = listIdFromRequest(req);
    const entryId = getParam(req, 'entry_id');
    const existing = store.get<Record<string, unknown>>(NS.listEntries(list), entryId);
    if (!existing) return send404(reply, 'List entry', entryId);

    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const incoming = (data.entry_values as Record<string, unknown>) ?? {};
    const existingValues = (existing.entry_values as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...existingValues };
    for (const [key, value] of Object.entries(incoming)) {
      if (append && Array.isArray(value) && Array.isArray(merged[key])) {
        merged[key] = [...(merged[key] as unknown[]), ...value];
      } else {
        merged[key] = Array.isArray(value) ? value : [value];
      }
    }
    const updated = { ...existing, entry_values: merged };
    store.set(NS.listEntries(list), entryId, updated);
    return sendData(reply, updated);
  };
}

export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const list = listIdFromRequest(req);
    const entryId = getParam(req, 'entry_id');
    if (!store.get(NS.listEntries(list), entryId)) return send404(reply, 'List entry', entryId);
    store.delete(NS.listEntries(list), entryId);
    return reply.code(200).send({});
  };
}

export function buildListAttributeValuesHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const list = listIdFromRequest(req);
    const entryId = getParam(req, 'entry_id');
    const attribute = getParam(req, 'attribute');
    const entry = store.get<Record<string, unknown>>(NS.listEntries(list), entryId);
    if (!entry) return send404(reply, 'List entry', entryId);
    const values = (entry.entry_values as Record<string, unknown> | undefined) ?? {};
    const arr = (values[attribute] ?? []) as unknown[];
    return sendData(reply, arr);
  };
}
