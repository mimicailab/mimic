import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { slackError, SLACK_ERROR_CODES } from '../slack-errors.js';
import { parseQuery } from './paginate.js';

const NS_FILES = 'slack:files';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    let files = store.list<Record<string, unknown>>(NS_FILES);
    if (q.user) files = files.filter((f) => f.user === q.user);
    if (q.channel) files = files.filter((f) => ((f.channels as string[] | undefined) ?? []).includes(q.channel!));
    if (q.types) {
      const types = q.types.split(',');
      files = files.filter((f) => types.includes(String(f.filetype)));
    }

    // Slack files.list uses page-based pagination with `paging` envelope.
    const page = Math.max(parseInt(q.page ?? '1', 10) || 1, 1);
    const count = Math.min(Math.max(parseInt(q.count ?? '100', 10) || 100, 1), 1000);
    const start = (page - 1) * count;
    const slice = files.slice(start, start + count);
    return reply.code(200).send({
      files: slice,
      paging: { count, total: files.length, page, pages: Math.max(1, Math.ceil(files.length / count)) },
    });
  };
}

export function buildInfoHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.file) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'file is required'));
    const file = store.get<Record<string, unknown>>(NS_FILES, q.file);
    if (!file) return reply.code(200).send(slackError('file_not_found'));
    return reply.code(200).send({ file, comments: [] });
  };
}
