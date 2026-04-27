import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultList } from '../generated/schemas.js';
import { NS, buildId, getParam, nowIso, parseBody, send404, sendData, uuid } from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (_req, reply) => {
    const items = store.list<Record<string, unknown>>(NS.lists);
    return sendData(reply, items);
  };
}

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const slug = (data.api_slug as string) ?? `list_${uuid().slice(0, 8)}`;
    const list = defaultList({
      ...data,
      id: buildId(data.id as Record<string, string> | undefined, 'list_id'),
      api_slug: slug,
      created_at: nowIso(),
    });
    store.set(NS.lists, slug, list);
    return sendData(reply, list);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'list');
    const list = store.get<Record<string, unknown>>(NS.lists, id);
    if (!list) return send404(reply, 'List', id);
    return sendData(reply, list);
  };
}

export function buildUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'list');
    const existing = store.get<Record<string, unknown>>(NS.lists, id);
    if (!existing) return send404(reply, 'List', id);
    const body = parseBody(req);
    const patch = (body.data ?? body) as Record<string, unknown>;
    const updated = { ...existing, ...patch };
    store.set(NS.lists, id, updated);
    return sendData(reply, updated);
  };
}

export function buildListViewsHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const list = getParam(req, 'list');
    const views = store.list<Record<string, unknown>>(NS.listViews(list));
    return sendData(reply, views);
  };
}
