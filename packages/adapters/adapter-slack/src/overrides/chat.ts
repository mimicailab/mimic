import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultMessage } from '../generated/schemas.js';
import { slackError, SLACK_ERROR_CODES } from '../slack-errors.js';
import { messageKey } from './conversations.js';
import { parseQuery } from './paginate.js';
import { getBotIdentity } from './fixtures.js';

const NS_CHANNELS = 'slack:channels';
const NS_MESSAGES = 'slack:messages';

function nextTs(): string {
  // Slack ts format: <unix_seconds>.<6-digit sequence>. Using nanoseconds
  // gives us monotonic ordering without coordination.
  const ns = process.hrtime.bigint();
  const sec = Number(ns / 1_000_000_000n);
  const seq = Number(ns % 1_000_000_000n) % 1_000_000;
  return `${sec}.${String(seq).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// chat.postMessage
// ---------------------------------------------------------------------------

export function buildPostMessageHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel is required'));
    if (!store.get(NS_CHANNELS, q.channel)) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.CHANNEL_NOT_FOUND));
    }

    const ts = nextTs();
    const bot = getBotIdentity(store);
    const message = defaultMessage({
      ts,
      user: q.user || (bot?.user_id as string | undefined) || 'USLACKBOT',
      text: q.text ?? '',
      channel: q.channel,
      thread_ts: q.thread_ts || undefined,
      blocks: q.blocks ? safeJsonParse(q.blocks) : [],
      attachments: q.attachments ? safeJsonParse(q.attachments) : [],
    });
    store.set(NS_MESSAGES, messageKey(q.channel, ts), message);

    // If this is a thread reply, bump the parent's reply_count
    if (q.thread_ts && q.thread_ts !== ts) {
      const parent = store.get<Record<string, unknown>>(NS_MESSAGES, messageKey(q.channel, q.thread_ts));
      if (parent) {
        parent.reply_count = ((parent.reply_count as number | undefined) ?? 0) + 1;
        parent.thread_ts = q.thread_ts;
        store.set(NS_MESSAGES, messageKey(q.channel, q.thread_ts), parent);
      }
    }

    return reply.code(200).send({ channel: q.channel, ts, message });
  };
}

// ---------------------------------------------------------------------------
// chat.postEphemeral
// ---------------------------------------------------------------------------

export function buildPostEphemeralHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel || !q.user) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel and user are required'));
    }
    if (!store.get(NS_CHANNELS, q.channel)) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.CHANNEL_NOT_FOUND));
    }
    // Ephemeral messages aren't persisted in the channel history
    const ts = nextTs();
    return reply.code(200).send({ message_ts: ts });
  };
}

// ---------------------------------------------------------------------------
// chat.update
// ---------------------------------------------------------------------------

export function buildUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel || !q.ts) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel and ts are required'));
    }
    const key = messageKey(q.channel, q.ts);
    const existing = store.get<Record<string, unknown>>(NS_MESSAGES, key);
    if (!existing) return reply.code(200).send(slackError(SLACK_ERROR_CODES.MESSAGE_NOT_FOUND));

    const updated = {
      ...existing,
      text: q.text ?? existing.text,
      blocks: q.blocks ? safeJsonParse(q.blocks) : existing.blocks,
      attachments: q.attachments ? safeJsonParse(q.attachments) : existing.attachments,
      edited: { user: q.as_user || existing.user, ts: nextTs() },
    };
    store.set(NS_MESSAGES, key, updated);
    return reply.code(200).send({
      channel: q.channel,
      ts: q.ts,
      text: updated.text,
      message: updated,
    });
  };
}

// ---------------------------------------------------------------------------
// chat.delete
// ---------------------------------------------------------------------------

export function buildDeleteHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel || !q.ts) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel and ts are required'));
    }
    const key = messageKey(q.channel, q.ts);
    if (!store.get(NS_MESSAGES, key)) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.MESSAGE_NOT_FOUND));
    }
    store.delete(NS_MESSAGES, key);
    return reply.code(200).send({ channel: q.channel, ts: q.ts });
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
