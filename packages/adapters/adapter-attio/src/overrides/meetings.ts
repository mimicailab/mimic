import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultMeeting } from '../generated/schemas.js';
import { NS, buildId, getParam, getQuery, nowIso, parseBody, send404, sendData } from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = getQuery(req);
    let items = store.list<Record<string, unknown>>(NS.meetings);
    if (q.linked_record_id) {
      items = items.filter((m) => {
        const linked = (m.linked_records as Array<Record<string, unknown>> | undefined) ?? [];
        return linked.some((l) => l.target_record_id === q.linked_record_id);
      });
    }
    if (q.start_after) items = items.filter((m) => (m.start_time as string) >= q.start_after!);
    if (q.start_before) items = items.filter((m) => (m.start_time as string) <= q.start_before!);
    const limit = Math.min(parseInt(q.limit ?? '50', 10) || 50, 100);
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);
    return sendData(reply, items.slice(offset, offset + limit));
  };
}

/**
 * POST /v2/meetings — Spec name "Find or create a meeting" (idempotent on
 * `external_meeting_id` if provided). Mock: simple find-by-external-id then
 * create-otherwise.
 */
export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const externalId = data.external_meeting_id as string | undefined;

    if (externalId) {
      const existing = store
        .list<Record<string, unknown>>(NS.meetings)
        .find((m) => m.external_meeting_id === externalId);
      if (existing) return sendData(reply, existing);
    }

    const id = buildId(data.id as Record<string, string> | undefined, 'meeting_id');
    const meeting = defaultMeeting({
      ...data,
      id,
      created_at: nowIso(),
    });
    store.set(NS.meetings, id.meeting_id!, meeting);
    return sendData(reply, meeting);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'meeting_id');
    const meeting = store.get<Record<string, unknown>>(NS.meetings, id);
    if (!meeting) return send404(reply, 'Meeting', id);
    return sendData(reply, meeting);
  };
}
