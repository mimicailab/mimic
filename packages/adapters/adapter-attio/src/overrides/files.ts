import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultFile } from '../generated/schemas.js';
import { NS, buildId, getParam, getQuery, nowIso, parseBody, send404, sendData } from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = getQuery(req);
    let items = store.list<Record<string, unknown>>(NS.files);
    if (q.parent_id) items = items.filter((f) => f.parent_id === q.parent_id);
    const limit = Math.min(parseInt(q.limit ?? '50', 10) || 50, 100);
    const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);
    return sendData(reply, items.slice(offset, offset + limit));
  };
}

/** POST /v2/files — Create a folder. */
export function buildCreateFolderHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'file_id');
    const folder = defaultFile({
      ...data,
      id,
      filename: (data.name as string) ?? (data.filename as string) ?? 'New folder',
      content_type: 'application/x-directory',
      is_writable: true,
      created_at: nowIso(),
    });
    store.set(NS.files, id.file_id!, folder);
    return sendData(reply, folder);
  };
}

/** POST /v2/files/upload — Upload a file. */
export function buildUploadHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'file_id');
    const file = defaultFile({
      ...data,
      id,
      filename: (data.filename as string) ?? 'upload',
      file_url: `https://attio.example/files/${id.file_id}`,
      created_at: nowIso(),
    });
    store.set(NS.files, id.file_id!, file);
    return sendData(reply, file);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'file_id');
    const file = store.get<Record<string, unknown>>(NS.files, id);
    if (!file) return send404(reply, 'File', id);
    return sendData(reply, file);
  };
}

export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'file_id');
    if (!store.get(NS.files, id)) return send404(reply, 'File', id);
    store.delete(NS.files, id);
    return reply.code(200).send({});
  };
}

export function buildDownloadHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'file_id');
    const file = store.get<Record<string, unknown>>(NS.files, id);
    if (!file) return send404(reply, 'File', id);
    // Mock download: return a 302-style redirect payload, since the real Attio
    // API issues a temporary signed URL. Tests can read `download_url`.
    return reply.code(200).send({
      data: {
        download_url: file.file_url ?? `https://attio.example/files/${id}/download`,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
  };
}
