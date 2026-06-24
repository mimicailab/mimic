import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { paddleError, paddleStateError } from '../paddle-errors.js';

const NS = 'paddle:subscriptions';

export function buildCancelHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(paddleError('not_found', `Subscription ${subscription_id} not found`));
    }

    if (existing.status === 'canceled') {
      return reply.code(409).send(paddleStateError(`Subscription ${subscription_id} is already canceled`));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const effectiveFrom = body.effective_from ?? 'next_billing_period';

    const updated = {
      ...existing,
      status: effectiveFrom === 'immediately' ? 'canceled' : existing.status,
      scheduled_change: effectiveFrom === 'immediately' ? null : {
        action: 'cancel',
        effective_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        resume_at: null,
      },
      canceled_at: effectiveFrom === 'immediately' ? new Date().toISOString() : existing.canceled_at,
      updated_at: new Date().toISOString(),
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
      return reply.code(404).send(paddleError('not_found', `Subscription ${subscription_id} not found`));
    }

    if (existing.status !== 'active') {
      return reply.code(409).send(paddleStateError(`Subscription ${subscription_id} must be active to pause, current status: ${existing.status}`));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const effectiveFrom = body.effective_from ?? 'next_billing_period';

    const updated = {
      ...existing,
      status: effectiveFrom === 'immediately' ? 'paused' : existing.status,
      scheduled_change: effectiveFrom === 'immediately' ? null : {
        action: 'pause',
        effective_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        resume_at: body.resume_at ?? null,
      },
      paused_at: effectiveFrom === 'immediately' ? new Date().toISOString() : existing.paused_at,
      updated_at: new Date().toISOString(),
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}
