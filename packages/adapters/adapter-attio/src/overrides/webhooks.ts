import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultWebhook } from '../generated/schemas.js';
import { NS, buildId, getParam, nowIso, parseBody, send404, sendData } from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (_req, reply) => {
    const items = store.list<Record<string, unknown>>(NS.webhooks);
    return sendData(reply, items);
  };
}

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'webhook_id');
    const wh = defaultWebhook({ ...data, id, created_at: nowIso() });
    store.set(NS.webhooks, id.webhook_id!, wh);
    return sendData(reply, wh);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'webhook_id');
    const wh = store.get<Record<string, unknown>>(NS.webhooks, id);
    if (!wh) return send404(reply, 'Webhook', id);
    return sendData(reply, wh);
  };
}

export function buildUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'webhook_id');
    const existing = store.get<Record<string, unknown>>(NS.webhooks, id);
    if (!existing) return send404(reply, 'Webhook', id);
    const body = parseBody(req);
    const patch = (body.data ?? body) as Record<string, unknown>;
    const updated = { ...existing, ...patch };
    store.set(NS.webhooks, id, updated);
    return sendData(reply, updated);
  };
}

export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'webhook_id');
    if (!store.get(NS.webhooks, id)) return send404(reply, 'Webhook', id);
    store.delete(NS.webhooks, id);
    return reply.code(200).send({});
  };
}
