import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { slackError, SLACK_ERROR_CODES } from '../slack-errors.js';
import { parseQuery } from './paginate.js';

const NS_MESSAGES = 'slack:messages';

/**
 * `search.messages` — naive substring search on `text`. Real Slack supports
 * a search DSL (`from:`, `in:`, `has:`); for the briefing agent's needs,
 * substring + optional `from:<userId>` filter is enough.
 */
export function buildMessagesHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.query) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'query is required'));

    const fromMatch = q.query.match(/from:(\S+)/);
    const fromUser = fromMatch ? fromMatch[1] : undefined;
    const text = q.query.replace(/from:\S+/g, '').trim().toLowerCase();

    let matches = store
      .list<Record<string, unknown>>(NS_MESSAGES)
      .filter((m) => (text ? String(m.text ?? '').toLowerCase().includes(text) : true));

    if (fromUser) matches = matches.filter((m) => m.user === fromUser);

    const sortDir = (q.sort_dir ?? 'desc').toLowerCase();
    matches.sort((a, b) => {
      const ta = parseFloat(String(a.ts ?? '0'));
      const tb = parseFloat(String(b.ts ?? '0'));
      return sortDir === 'asc' ? ta - tb : tb - ta;
    });

    const page = Math.max(parseInt(q.page ?? '1', 10) || 1, 1);
    const count = Math.min(Math.max(parseInt(q.count ?? '20', 10) || 20, 1), 100);
    const start = (page - 1) * count;
    const slice = matches.slice(start, start + count).map((m) => ({
      ...m,
      type: 'message',
      iid: `${m.channel}:${m.ts}`,
      permalink: `https://acme.slack.com/archives/${m.channel}/p${String(m.ts).replace('.', '')}`,
    }));

    return reply.code(200).send({
      query: q.query,
      messages: {
        total: matches.length,
        pagination: { total_count: matches.length, page, per_page: count, page_count: Math.max(1, Math.ceil(matches.length / count)), first: start + 1, last: start + slice.length },
        paging: { count, total: matches.length, page, pages: Math.max(1, Math.ceil(matches.length / count)) },
        matches: slice,
      },
    });
  };
}
