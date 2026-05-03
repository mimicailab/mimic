import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { generateId } from '@mimicai/adapter-sdk';
import { defaultChannel } from '../generated/schemas.js';
import { slackError, SLACK_ERROR_CODES } from '../slack-errors.js';
import { paginateByCursor, parseQuery } from './paginate.js';

// Namespaces match the spec resource names (singular) so the SDK seeder's
// default fallback (`<adapter>:<resourceType>`) writes data to the same
// place the override reads from. See OpenApiMockAdapter.seedExpandedData.
const NS_CHANNELS = 'slack:channel';
const NS_MESSAGES = 'slack:message';

/** Compose a stable storage key for a message: `${channelId}:${ts}`. */
export function messageKey(channel: string, ts: string): string {
  return `${channel}:${ts}`;
}

// ---------------------------------------------------------------------------
// conversations.list
// ---------------------------------------------------------------------------

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    const types = (q.types ?? 'public_channel').split(',').map((t) => t.trim());
    const excludeArchived = q.exclude_archived === 'true';

    let channels = store.list<Record<string, unknown>>(NS_CHANNELS);
    channels = channels.filter((c) => {
      if (excludeArchived && c.is_archived) return false;
      // types: public_channel, private_channel, mpim, im
      if (types.includes('public_channel') && c.is_channel && !c.is_private) return true;
      if (types.includes('private_channel') && c.is_private) return true;
      if (types.includes('mpim') && c.is_mpim) return true;
      if (types.includes('im') && c.is_im) return true;
      return false;
    });

    const { page, nextCursor } = paginateByCursor(channels, q.cursor, Number(q.limit) || 100);
    const body: Record<string, unknown> = { channels: page };
    body.response_metadata = { next_cursor: nextCursor ?? '' };
    return reply.code(200).send(body);
  };
}

// ---------------------------------------------------------------------------
// conversations.info
// ---------------------------------------------------------------------------

export function buildInfoHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel is required'));
    const channel = store.get<Record<string, unknown>>(NS_CHANNELS, q.channel);
    if (!channel) return reply.code(200).send(slackError(SLACK_ERROR_CODES.CHANNEL_NOT_FOUND));
    return reply.code(200).send({ channel });
  };
}

// ---------------------------------------------------------------------------
// conversations.history — top-level messages in a channel
// ---------------------------------------------------------------------------

export function buildHistoryHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel is required'));
    if (!store.get(NS_CHANNELS, q.channel)) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.CHANNEL_NOT_FOUND));
    }

    // Top-level messages: messages whose thread_ts is empty or equal to ts
    let messages = store
      .list<Record<string, unknown>>(NS_MESSAGES)
      .filter((m) => m.channel === q.channel)
      .filter((m) => !m.thread_ts || m.thread_ts === m.ts);

    if (q.oldest) messages = messages.filter((m) => parseFloat(String(m.ts)) > parseFloat(q.oldest));
    if (q.latest) messages = messages.filter((m) => parseFloat(String(m.ts)) < parseFloat(q.latest));
    messages.sort((a, b) => parseFloat(String(b.ts)) - parseFloat(String(a.ts)));

    const { page, nextCursor } = paginateByCursor(messages, q.cursor, Number(q.limit) || 100);
    return reply.code(200).send({
      messages: page,
      has_more: nextCursor !== null,
      pin_count: 0,
      response_metadata: { next_cursor: nextCursor ?? '' },
    });
  };
}

// ---------------------------------------------------------------------------
// conversations.replies — thread (parent + replies)
// ---------------------------------------------------------------------------

export function buildRepliesHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel || !q.ts) {
      return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel and ts are required'));
    }
    const parent = store.get<Record<string, unknown>>(NS_MESSAGES, messageKey(q.channel, q.ts));
    if (!parent) return reply.code(200).send(slackError(SLACK_ERROR_CODES.MESSAGE_NOT_FOUND));

    // Parent + every message whose thread_ts matches the parent's ts
    const replies = store
      .list<Record<string, unknown>>(NS_MESSAGES)
      .filter((m) => m.channel === q.channel && m.thread_ts === q.ts && m.ts !== q.ts)
      .sort((a, b) => parseFloat(String(a.ts)) - parseFloat(String(b.ts)));

    const all = [parent, ...replies];
    const { page, nextCursor } = paginateByCursor(all, q.cursor, Number(q.limit) || 100);
    return reply.code(200).send({
      messages: page,
      has_more: nextCursor !== null,
      response_metadata: { next_cursor: nextCursor ?? '' },
    });
  };
}

// ---------------------------------------------------------------------------
// conversations.members
// ---------------------------------------------------------------------------

export function buildMembersHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.channel) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'channel is required'));
    const channel = store.get<Record<string, unknown>>(NS_CHANNELS, q.channel);
    if (!channel) return reply.code(200).send(slackError(SLACK_ERROR_CODES.CHANNEL_NOT_FOUND));

    const members = (channel.members as string[] | undefined) ?? [];
    const { page, nextCursor } = paginateByCursor(
      members.map((id) => ({ id })),
      q.cursor,
      Number(q.limit) || 100,
    );
    return reply.code(200).send({
      members: page.map((p) => p.id),
      response_metadata: { next_cursor: nextCursor ?? '' },
    });
  };
}

// ---------------------------------------------------------------------------
// conversations.create
// ---------------------------------------------------------------------------

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    if (!q.name) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'name is required'));
    const isPrivate = q.is_private === 'true';
    const channel = defaultChannel({
      id: generateId('C', 9).toUpperCase(),
      name: q.name,
      is_private: isPrivate,
      is_channel: !isPrivate,
      is_group: isPrivate,
      members: [],
    });
    store.set(NS_CHANNELS, channel.id as string, channel);
    return reply.code(200).send({ channel });
  };
}

// ---------------------------------------------------------------------------
// conversations.open — direct message / multi-person DM
// ---------------------------------------------------------------------------

export function buildOpenHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    // Already open?
    if (q.channel) {
      const existing = store.get<Record<string, unknown>>(NS_CHANNELS, q.channel);
      if (existing) return reply.code(200).send({ channel: { id: existing.id }, no_op: true, already_open: true });
    }
    // Open a new IM/MPIM
    const userIds = (q.users ?? '').split(',').filter(Boolean);
    const isMpim = userIds.length > 1;
    const channel = defaultChannel({
      id: generateId(isMpim ? 'G' : 'D', 9).toUpperCase(),
      is_im: !isMpim,
      is_mpim: isMpim,
      is_channel: false,
      is_private: true,
      members: userIds,
    });
    store.set(NS_CHANNELS, channel.id as string, channel);
    return reply.code(200).send({ channel: { id: channel.id } });
  };
}
