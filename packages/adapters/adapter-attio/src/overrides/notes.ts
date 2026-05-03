import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultNote } from '../generated/schemas.js';
import { NS, buildId, getParam, getQuery, nowIso, parseBody, send404, sendData } from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = getQuery(req);
    let items = store.list<Record<string, unknown>>(NS.notes);
    if (q.parent_object) items = items.filter((n) => n.parent_object === q.parent_object);
    if (q.parent_record_id) items = items.filter((n) => n.parent_record_id === q.parent_record_id);
    const limit = Math.min(parseInt(q.limit ?? '50', 10) || 50, 100);
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);
    return sendData(reply, items.slice(offset, offset + limit));
  };
}

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'note_id');
    const note = defaultNote({
      ...data,
      id,
      created_at: nowIso(),
    });
    store.set(NS.notes, id.note_id!, note);
    return sendData(reply, note);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'note_id');
    const note = store.get<Record<string, unknown>>(NS.notes, id);
    if (!note) return send404(reply, 'Note', id);
    return sendData(reply, note);
  };
}

export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'note_id');
    if (!store.get(NS.notes, id)) return send404(reply, 'Note', id);
    store.delete(NS.notes, id);
    return reply.code(200).send({});
  };
}
