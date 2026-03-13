import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { generateId } from '@mimicai/adapter-sdk';
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

export function buildResumeHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(paddleError('not_found', `Subscription ${subscription_id} not found`));
    }

    if (existing.status !== 'paused') {
      return reply.code(409).send(paddleStateError(`Subscription ${subscription_id} must be paused to resume, current status: ${existing.status}`));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const effectiveFrom = body.effective_from ?? 'immediately';

    const updated = {
      ...existing,
      status: effectiveFrom === 'immediately' ? 'active' : existing.status,
      scheduled_change: effectiveFrom === 'immediately' ? null : {
        action: 'resume',
        effective_at: body.effective_from,
        resume_at: null,
      },
      paused_at: effectiveFrom === 'immediately' ? null : existing.paused_at,
      updated_at: new Date().toISOString(),
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildActivateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(paddleError('not_found', `Subscription ${subscription_id} not found`));
    }

    if (existing.status !== 'trialing') {
      return reply.code(409).send(paddleStateError(`Subscription ${subscription_id} must be trialing to activate, current status: ${existing.status}`));
    }

    const updated = {
      ...existing,
      status: 'active',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}
