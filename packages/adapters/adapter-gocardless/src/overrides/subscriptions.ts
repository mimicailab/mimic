import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { gcNotFound, gcStateError } from '../gocardless-errors.js';

const NS = 'gocardless:subscriptions';

export function buildCancelHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(gcNotFound('subscription', subscription_id));
    }

    if (existing.status === 'cancelled') {
      return reply.code(409).send(gcStateError(`Subscription ${subscription_id} is already cancelled`));
    }

    const updated = { ...existing, status: 'cancelled' };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send({ subscriptions: updated });
  };
}

export function buildPauseHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(gcNotFound('subscription', subscription_id));
    }

    if (existing.status !== 'active') {
      return reply.code(409).send(gcStateError(`Subscription ${subscription_id} must be active to pause, current: ${existing.status}`));
    }

    const updated = { ...existing, status: 'paused' };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send({ subscriptions: updated });
  };
}

export function buildResumeHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(gcNotFound('subscription', subscription_id));
    }

    if (existing.status !== 'paused') {
      return reply.code(409).send(gcStateError(`Subscription ${subscription_id} must be paused to resume, current: ${existing.status}`));
    }

    const updated = { ...existing, status: 'active' };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send({ subscriptions: updated });
  };
}
