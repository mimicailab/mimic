import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultObject } from '../generated/schemas.js';
import {
  NS,
  buildId,
  getParam,
  nowIso,
  parseBody,
  send404,
  sendData,
  uuid,
} from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (_req, reply) => {
    const items = store.list<Record<string, unknown>>(NS.objects);
    return sendData(reply, items);
  };
}

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const slug = (data.api_slug as string) ?? `object_${uuid().slice(0, 8)}`;
    const obj = defaultObject({
      ...data,
      id: buildId(data.id as Record<string, string> | undefined, 'object_id'),
      api_slug: slug,
      created_at: nowIso(),
    });
    store.set(NS.objects, slug, obj);
    return sendData(reply, obj);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'object');
    const obj = store.get<Record<string, unknown>>(NS.objects, id);
    if (!obj) return send404(reply, 'Object', id);
    return sendData(reply, obj);
  };
}

export function buildUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'object');
    const existing = store.get<Record<string, unknown>>(NS.objects, id);
    if (!existing) return send404(reply, 'Object', id);
    const body = parseBody(req);
    const patch = (body.data ?? body) as Record<string, unknown>;
    const updated = { ...existing, ...patch };
    store.set(NS.objects, id, updated);
    return sendData(reply, updated);
  };
}

export function buildListViewsHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const object = getParam(req, 'object');
    const views = store.list<Record<string, unknown>>(NS.objectViews(object));
    return sendData(reply, views);
  };
}
