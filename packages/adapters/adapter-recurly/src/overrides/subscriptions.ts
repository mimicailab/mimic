import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { recurlyNotFound, recurlyStateError } from '../recurly-errors.js';

const NS = 'recurly:subscriptions';

export function buildCancelHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Subscription', subscription_id));
    }

    if (existing.state !== 'active' && existing.state !== 'future') {
      return reply.code(422).send(
        recurlyStateError(`Subscription is ${existing.state}, cannot cancel`),
      );
    }

    const updated = {
      ...existing,
      state: 'canceled',
      canceled_at: new Date().toISOString(),
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildPauseHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Subscription', subscription_id));
    }

    if (existing.state !== 'active') {
      return reply.code(422).send(
        recurlyStateError(`Subscription is ${existing.state}, cannot pause`),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = {
      ...existing,
      state: 'paused',
      paused_at: new Date().toISOString(),
      remaining_pause_cycles: body.remaining_pause_cycles ?? 1,
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildResumeHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Subscription', subscription_id));
    }

    if (existing.state !== 'paused') {
      return reply.code(422).send(
        recurlyStateError(`Subscription is ${existing.state}, cannot resume`),
      );
    }

    const updated = {
      ...existing,
      state: 'active',
      paused_at: null,
      remaining_pause_cycles: null,
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildReactivateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Subscription', subscription_id));
    }

    if (existing.state !== 'canceled' && existing.state !== 'expired') {
      return reply.code(422).send(
        recurlyStateError(`Subscription is ${existing.state}, cannot reactivate`),
      );
    }

    const updated = {
      ...existing,
      state: 'active',
      canceled_at: null,
      activated_at: new Date().toISOString(),
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildTerminateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Subscription', subscription_id));
    }

    const updated = {
      ...existing,
      state: 'expired',
      expires_at: new Date().toISOString(),
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildConvertTrialHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Subscription', subscription_id));
    }

    const updated = {
      ...existing,
      state: 'active',
      converted_at: new Date().toISOString(),
      trial_ends_at: new Date().toISOString(),
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}
