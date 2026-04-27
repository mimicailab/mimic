import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { slackError, SLACK_ERROR_CODES } from '../slack-errors.js';
import { messageKey } from './conversations.js';
import { paginateByCursor, parseQuery } from './paginate.js';
import { getBotIdentity } from './fixtures.js';

const NS_MESSAGES = 'slack:messages';

interface Reaction {
  name: string;
  users: string[];
  count: number;
}

function getReactions(message: Record<string, unknown>): Reaction[] {
  return ((message.reactions as Reaction[] | undefined) ?? []).map((r) => ({ ...r, users: [...r.users] }));
}

export function buildAddHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel || !q.timestamp || !q.name) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel, timestamp, and name are required'));
    }
    const key = messageKey(q.channel, q.timestamp);
    const message = store.get<Record<string, unknown>>(NS_MESSAGES, key);
    if (!message) return reply.code(200).send(slackError(SLACK_ERROR_CODES.MESSAGE_NOT_FOUND));

    const bot = getBotIdentity(store);
    const userId = (bot?.user_id as string | undefined) ?? 'USLACKBOT';
    const reactions = getReactions(message);
    const existing = reactions.find((r) => r.name === q.name);
    if (existing) {
      if (existing.users.includes(userId)) {
        return reply.code(200).send(slackError('already_reacted'));
      }
      existing.users.push(userId);
      existing.count = existing.users.length;
    } else {
      reactions.push({ name: q.name, users: [userId], count: 1 });
    }
    store.set(NS_MESSAGES, key, { ...message, reactions });
    return reply.code(200).send({});
  };
}

export function buildRemoveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel || !q.timestamp || !q.name) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel, timestamp, and name are required'));
    }
    const key = messageKey(q.channel, q.timestamp);
    const message = store.get<Record<string, unknown>>(NS_MESSAGES, key);
    if (!message) return reply.code(200).send(slackError(SLACK_ERROR_CODES.MESSAGE_NOT_FOUND));

    const bot = getBotIdentity(store);
    const userId = (bot?.user_id as string | undefined) ?? 'USLACKBOT';
    const reactions = getReactions(message)
      .map((r) => (r.name === q.name ? { ...r, users: r.users.filter((u) => u !== userId), count: r.users.filter((u) => u !== userId).length } : r))
      .filter((r) => r.count > 0);
    store.set(NS_MESSAGES, key, { ...message, reactions });
    return reply.code(200).send({});
  };
}

export function buildGetHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel || !q.timestamp) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel and timestamp are required'));
    }
    const message = store.get<Record<string, unknown>>(NS_MESSAGES, messageKey(q.channel, q.timestamp));
    if (!message) return reply.code(200).send(slackError(SLACK_ERROR_CODES.MESSAGE_NOT_FOUND));
    return reply.code(200).send({
      type: 'message',
      channel: q.channel,
      message: { ...message, reactions: getReactions(message) },
    });
  };
}

/**
 * `reactions.list` — list reactions made by a specific user across the
 * workspace. We scan the message store for messages where any reaction's
 * `users` array contains the queried user.
 */
export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    const user = q.user;
    const messages = store.list<Record<string, unknown>>(NS_MESSAGES);
    const items = messages
      .filter((m) => {
        const rs = getReactions(m);
        return rs.some((r) => (user ? r.users.includes(user) : true));
      })
      .map((m) => ({
        type: 'message',
        channel: m.channel,
        message: { ...m, reactions: getReactions(m) },
      }));
    const { page, nextCursor } = paginateByCursor(items.map((i, idx) => ({ ...i, id: String(idx) })), q.cursor, Number(q.limit) || 100);
    return reply.code(200).send({
      items: page.map(({ id: _id, ...rest }) => rest),
      response_metadata: { next_cursor: nextCursor ?? '' },
    });
  };
}
