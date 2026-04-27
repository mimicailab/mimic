import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultProfile } from '../generated/schemas.js';

const NS_PROFILE = 'gmail:profile';
const NS_MESSAGES = 'gmail:messages';
const NS_THREADS = 'gmail:threads';

/**
 * Singleton profile resolution: look up `gmail:profile` keyed by `userId`. If
 * absent, compute a default from current store counts and the userId.
 */
function resolveProfile(store: StateStore, userId: string): Record<string, unknown> {
  const stored = store.get<Record<string, unknown>>(NS_PROFILE, userId);
  if (stored) return stored;

  const messagesTotal = store.list(NS_MESSAGES).length;
  const threadsTotal = store.list(NS_THREADS).length;
  const profile = defaultProfile({
    emailAddress: userId === 'me' ? 'user@example.com' : userId,
    messagesTotal,
    threadsTotal,
  });
  store.set(NS_PROFILE, userId, profile);
  return profile;
}

export function buildGetProfileHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.code(200).send(resolveProfile(store, userId));
  };
}

/**
 * `users.watch` — register a Pub/Sub push subscription. We return a synthetic
 * historyId + expiration so callers can persist them.
 */
export function buildWatchHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const profile = resolveProfile(store, userId);
    const historyId = profile.historyId ?? String(Date.now());
    return reply.code(200).send({
      historyId,
      // 7-day expiration in epoch ms — matches Gmail's real behaviour
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  };
}

/** `users.stop` — cancel push notifications. Returns empty 200. */
export function buildStopHandler(): OverrideHandler {
  return async (_req, reply) => {
    return reply.code(204).send();
  };
}
