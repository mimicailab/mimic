import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultTask } from '../generated/schemas.js';
import { NS, buildId, getParam, getQuery, nowIso, parseBody, send404, sendData } from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = getQuery(req);
    let items = store.list<Record<string, unknown>>(NS.tasks);

    if (q.linked_object && q.linked_record_id) {
      items = items.filter((t) => {
        const linked = (t.linked_records as Array<Record<string, unknown>> | undefined) ?? [];
        return linked.some((l) => l.target_object === q.linked_object && l.target_record_id === q.linked_record_id);
      });
    }
    if (q.assignee) {
      items = items.filter((t) => {
        const assignees = (t.assignees as Array<Record<string, unknown>> | undefined) ?? [];
        return assignees.some((a) => a.referenced_actor_id === q.assignee || a.workspace_member_id === q.assignee);
      });
    }
    if (q.is_completed !== undefined) {
      const wantCompleted = q.is_completed === 'true';
      items = items.filter((t) => Boolean(t.is_completed) === wantCompleted);
    }

    const limit = Math.min(parseInt(q.limit ?? '50', 10) || 50, 100);
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);
    return sendData(reply, items.slice(offset, offset + limit));
  };
}

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'task_id');
    const task = defaultTask({ ...data, id, created_at: nowIso() });
    store.set(NS.tasks, id.task_id!, task);
    return sendData(reply, task);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'task_id');
    const task = store.get<Record<string, unknown>>(NS.tasks, id);
    if (!task) return send404(reply, 'Task', id);
    return sendData(reply, task);
  };
}

export function buildUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'task_id');
    const existing = store.get<Record<string, unknown>>(NS.tasks, id);
    if (!existing) return send404(reply, 'Task', id);
    const body = parseBody(req);
    const patch = (body.data ?? body) as Record<string, unknown>;
    const updated = { ...existing, ...patch };
    store.set(NS.tasks, id, updated);
    return sendData(reply, updated);
  };
}

export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'task_id');
    if (!store.get(NS.tasks, id)) return send404(reply, 'Task', id);
    store.delete(NS.tasks, id);
    return reply.code(200).send({});
  };
}
