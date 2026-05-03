import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { NS, getParam, getQuery, send404, sendData } from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = getQuery(req);
    let items = store.list<Record<string, unknown>>(NS.threads);
    if (q.parent_object) items = items.filter((t) => t.parent_object === q.parent_object);
    if (q.parent_record_id) items = items.filter((t) => t.parent_record_id === q.parent_record_id);
    if (q.list) items = items.filter((t) => (t.list_id as string | undefined) === q.list);
    if (q.entry_id) items = items.filter((t) => (t.entry_id as string | undefined) === q.entry_id);
    const limit = Math.min(parseInt(q.limit ?? '50', 10) || 50, 100);
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);
    return sendData(reply, items.slice(offset, offset + limit));
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'thread_id');
    const thread = store.get<Record<string, unknown>>(NS.threads, id);
    if (!thread) return send404(reply, 'Thread', id);
    return sendData(reply, thread);
  };
}
