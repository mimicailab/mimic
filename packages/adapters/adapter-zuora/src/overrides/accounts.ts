import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { notFound } from '../zuora-errors.js';

const NS_ACCOUNTS = 'zuora:accounts';
const NS_SUBS = 'zuora:subscriptions';
const NS_INVOICES = 'zuora:invoices';
const NS_PAYMENTS = 'zuora:payments';

export function buildGetAccountHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { accountKey } = req.params as { accountKey: string };
    const account = store.get(NS_ACCOUNTS, accountKey);
    if (!account) return reply.code(404).send(notFound('Account', accountKey));
    return reply.code(200).send({ basicInfo: account });
  };
}

export function buildSummaryHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { accountKey } = req.params as { accountKey: string };
    const account = store.get<Record<string, unknown>>(NS_ACCOUNTS, accountKey);
    if (!account) return reply.code(404).send(notFound('Account', accountKey));
    const subscriptions = store.list<Record<string, unknown>>(NS_SUBS).filter(s => s.accountId === accountKey);
    const invoices = store.list<Record<string, unknown>>(NS_INVOICES).filter(i => i.accountId === accountKey);
    const payments = store.list<Record<string, unknown>>(NS_PAYMENTS).filter(p => p.accountId === accountKey);
    return reply.code(200).send({
      basicInfo: account,
      subscriptions,
      invoices,
      payments,
    });
  };
}
