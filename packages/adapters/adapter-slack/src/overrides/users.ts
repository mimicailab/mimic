import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { slackError, SLACK_ERROR_CODES } from '../slack-errors.js';
import { paginateByCursor, parseQuery } from './paginate.js';

const NS_USERS = 'slack:users';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    const users = store.list<Record<string, unknown>>(NS_USERS);
    const { page, nextCursor } = paginateByCursor(users, q.cursor, Number(q.limit) || 100);
    const body: Record<string, unknown> = { members: page, cache_ts: Math.floor(Date.now() / 1000) };
    if (nextCursor) body.response_metadata = { next_cursor: nextCursor };
    else body.response_metadata = { next_cursor: '' };
    return reply.code(200).send(body);
  };
}

export function buildInfoHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    const id = q.user;
    if (!id) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'user is required'));
    const user = store.get<Record<string, unknown>>(NS_USERS, id);
    if (!user) return reply.code(200).send(slackError(SLACK_ERROR_CODES.USER_NOT_FOUND));
    return reply.code(200).send({ user });
  };
}

/**
 * `users.lookupByEmail` is the high-value method for the briefing agent —
 * given a meeting attendee's email, find the matching workspace user so we
 * can pull their internal mentions, status, etc.
 */
export function buildLookupByEmailHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    const email = q.email;
    if (!email) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'email is required'));

    const users = store.list<Record<string, unknown>>(NS_USERS);
    const match = users.find((u) => {
      const profile = (u.profile as { email?: string } | undefined) ?? {};
      return profile.email?.toLowerCase() === email.toLowerCase();
    });
    if (!match) return reply.code(200).send(slackError(SLACK_ERROR_CODES.USER_NOT_FOUND));
    return reply.code(200).send({ user: match });
  };
}

export function buildProfileGetHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = parseQuery(req);
    const id = q.user;
    if (!id) return reply.code(200).send(slackError(SLACK_ERROR_CODES.INVALID_ARGUMENTS, 'user is required'));
    const user = store.get<Record<string, unknown>>(NS_USERS, id);
    if (!user) return reply.code(200).send(slackError(SLACK_ERROR_CODES.USER_NOT_FOUND));
    return reply.code(200).send({ profile: user.profile ?? {} });
  };
}
