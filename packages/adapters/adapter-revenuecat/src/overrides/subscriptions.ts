import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { rcNotFound, rcStateError } from '../revenuecat-errors.js';

const NS = 'revenuecat:subscriptions';

export function buildCancelHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(rcNotFound('subscription', subscription_id));
    }

    if (existing.status === 'expired') {
      return reply.code(409).send(rcStateError(`Subscription ${subscription_id} is already expired`));
    }

    const updated = {
      ...existing,
      status: 'expired',
      auto_renewal_status: 'will_not_renew',
      gives_access: false,
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildRefundHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscription_id } = req.params as { subscription_id: string };
    const existing = store.get<Record<string, unknown>>(NS, subscription_id);

    if (!existing) {
      return reply.code(404).send(rcNotFound('subscription', subscription_id));
    }

    const updated = {
      ...existing,
      status: 'expired',
      auto_renewal_status: 'will_not_renew',
      gives_access: false,
    };
    store.set(NS, subscription_id, updated);
    return reply.code(200).send(updated);
  };
}
