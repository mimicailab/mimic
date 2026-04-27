import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultCallRecording } from '../generated/schemas.js';
import { NS, buildId, getParam, nowIso, parseBody, send404, sendData } from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const meetingId = getParam(req, 'meeting_id');
    const items = store.list<Record<string, unknown>>(NS.callRecordings(meetingId));
    return sendData(reply, items);
  };
}

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const meetingId = getParam(req, 'meeting_id');
    if (!store.get(NS.meetings, meetingId)) return send404(reply, 'Meeting', meetingId);
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'call_recording_id');
    const rec = defaultCallRecording({
      ...data,
      id,
      meeting_id: meetingId,
      created_at: nowIso(),
    });
    store.set(NS.callRecordings(meetingId), id.call_recording_id!, rec);
    return sendData(reply, rec);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const meetingId = getParam(req, 'meeting_id');
    const recId = getParam(req, 'call_recording_id');
    const rec = store.get<Record<string, unknown>>(NS.callRecordings(meetingId), recId);
    if (!rec) return send404(reply, 'Call recording', recId);
    return sendData(reply, rec);
  };
}

export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const meetingId = getParam(req, 'meeting_id');
    const recId = getParam(req, 'call_recording_id');
    if (!store.get(NS.callRecordings(meetingId), recId)) return send404(reply, 'Call recording', recId);
    store.delete(NS.callRecordings(meetingId), recId);
    return reply.code(200).send({});
  };
}

export function buildTranscriptHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const meetingId = getParam(req, 'meeting_id');
    const recId = getParam(req, 'call_recording_id');
    const rec = store.get<Record<string, unknown>>(NS.callRecordings(meetingId), recId);
    if (!rec) return send404(reply, 'Call recording', recId);
    const transcript = (rec.transcript as string | undefined) ?? '';
    return sendData(reply, {
      call_recording_id: recId,
      transcript,
      generated_at: rec.created_at ?? nowIso(),
    });
  };
}
