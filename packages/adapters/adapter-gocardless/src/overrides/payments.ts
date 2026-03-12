import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { gcNotFound, gcStateError } from '../gocardless-errors.js';

const NS = 'gocardless:payments';

export function buildCancelHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { payment_id } = req.params as { payment_id: string };
    const existing = store.get<Record<string, unknown>>(NS, payment_id);

    if (!existing) {
      return reply.code(404).send(gcNotFound('payment', payment_id));
    }

    const cancellable = new Set(['pending_submission', 'submitted', 'pending_customer_approval']);
    if (!cancellable.has(existing.status as string)) {
      return reply.code(409).send(gcStateError(`Payment ${payment_id} cannot be cancelled in status: ${existing.status}`));
    }

    const updated = { ...existing, status: 'cancelled' };
    store.set(NS, payment_id, updated);
    return reply.code(200).send({ payments: updated });
  };
}

export function buildRetryHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { payment_id } = req.params as { payment_id: string };
    const existing = store.get<Record<string, unknown>>(NS, payment_id);

    if (!existing) {
      return reply.code(404).send(gcNotFound('payment', payment_id));
    }

    if (existing.status !== 'failed') {
      return reply.code(409).send(gcStateError(`Payment ${payment_id} must be failed to retry, current: ${existing.status}`));
    }

    const updated = { ...existing, status: 'pending_submission' };
    store.set(NS, payment_id, updated);
    return reply.code(200).send({ payments: updated });
  };
}
