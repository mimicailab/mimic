import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { slackError, SLACK_ERROR_CODES } from '../slack-errors.js';
import { messageKey } from './conversations.js';
import { parseQuery } from './paginate.js';

const NS_MESSAGES = 'slack:message';
const NS_PINS = 'slack:pins';

interface PinRecord {
  id: string;
  channel: string;
  ts: string;
  type: 'message';
  created: number;
}

function pinKey(channel: string, ts: string): string {
  return `${channel}:${ts}`;
}

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel is required'));

    const pins = store.list<PinRecord>(NS_PINS).filter((p) => p.channel === q.channel);
    const items = pins
      .map((p) => {
        const msg = store.get<Record<string, unknown>>(NS_MESSAGES, messageKey(p.channel, p.ts));
        if (!msg) return null;
        return { type: 'message', channel: p.channel, created: p.created, message: msg };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return reply.code(200).send({ items });
  };
}

export function buildAddHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel || !q.timestamp) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel and timestamp are required'));
    }
    if (!store.get(NS_MESSAGES, messageKey(q.channel, q.timestamp))) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.MESSAGE_NOT_FOUND));
    }
    const key = pinKey(q.channel, q.timestamp);
    if (!store.get(NS_PINS, key)) {
      store.set(NS_PINS, key, {
        id: key,
        channel: q.channel,
        ts: q.timestamp,
        type: 'message',
        created: Math.floor(Date.now() / 1000),
      } satisfies PinRecord);
    }
    return reply.code(200).send({});
  };
}

export function buildRemoveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel || !q.timestamp) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel and timestamp are required'));
    }
    store.delete(NS_PINS, pinKey(q.channel, q.timestamp));
    return reply.code(200).send({});
  };
}
