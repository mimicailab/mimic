import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { recurlyNotFound, recurlyStateError } from '../recurly-errors.js';

const NS_ACCOUNTS = 'recurly:accounts';
const NS_SUBSCRIPTIONS = 'recurly:subscriptions';

export function buildDeactivateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { account_id } = req.params as { account_id: string };
    const existing = store.get<Record<string, unknown>>(NS_ACCOUNTS, account_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Account', account_id));
    }

    if (existing.state === 'closed') {
      return reply.code(422).send(
        recurlyStateError(`Account is already closed`),
      );
    }

    // Cancel all active subscriptions for this account
    const subs = store.list<Record<string, unknown>>(NS_SUBSCRIPTIONS);
    for (const sub of subs) {
      const acct = sub.account as Record<string, unknown> | undefined;
      if ((acct?.id === account_id || sub.account === account_id) && sub.state === 'active') {
        store.set(NS_SUBSCRIPTIONS, sub.id as string, {
          ...sub,
          state: 'canceled',
          canceled_at: new Date().toISOString(),
        });
      }
    }

    const updated = {
      ...existing,
      state: 'closed',
      deleted_at: new Date().toISOString(),
    };
    store.set(NS_ACCOUNTS, account_id, updated);
    return reply.code(200).send(updated);
  };
}

export function buildReactivateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { account_id } = req.params as { account_id: string };
    const existing = store.get<Record<string, unknown>>(NS_ACCOUNTS, account_id);

    if (!existing) {
      return reply.code(404).send(recurlyNotFound('Account', account_id));
    }

    if (existing.state !== 'closed') {
      return reply.code(422).send(
        recurlyStateError(`Account is ${existing.state}, cannot reactivate`),
      );
    }

    const updated = {
      ...existing,
      state: 'active',
      deleted_at: null,
    };
    store.set(NS_ACCOUNTS, account_id, updated);
    return reply.code(200).send(updated);
  };
}
