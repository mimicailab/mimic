import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { notFound } from '../zuora-errors.js';

const NS = 'zuora:subscriptions';

function isoNow(): string {
  return new Date().toISOString();
}

export function buildCancelHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscriptionKey } = req.params as { subscriptionKey: string };
    const existing = store.get<Record<string, unknown>>(NS, subscriptionKey);
    if (!existing) return reply.code(404).send(notFound('Subscription', subscriptionKey));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = {
      ...existing,
      ...body,
      status: 'Cancelled',
      cancelledDate: isoNow(),
      updatedDate: isoNow(),
    };
    store.set(NS, subscriptionKey, updated);
    return reply.code(200).send({ subscriptionId: subscriptionKey });
  };
}

export function buildRenewHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscriptionKey } = req.params as { subscriptionKey: string };
    const existing = store.get<Record<string, unknown>>(NS, subscriptionKey);
    if (!existing) return reply.code(404).send(notFound('Subscription', subscriptionKey));
    const updated = { ...existing, status: 'Active', updatedDate: isoNow() };
    store.set(NS, subscriptionKey, updated);
    return reply.code(200).send({ subscriptionId: subscriptionKey });
  };
}

export function buildSuspendHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscriptionKey } = req.params as { subscriptionKey: string };
    const existing = store.get<Record<string, unknown>>(NS, subscriptionKey);
    if (!existing) return reply.code(404).send(notFound('Subscription', subscriptionKey));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = {
      ...existing,
      ...body,
      status: 'Suspended',
      suspendedDate: isoNow(),
      updatedDate: isoNow(),
    };
    store.set(NS, subscriptionKey, updated);
    return reply.code(200).send({ subscriptionId: subscriptionKey });
  };
}

export function buildResumeHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { subscriptionKey } = req.params as { subscriptionKey: string };
    const existing = store.get<Record<string, unknown>>(NS, subscriptionKey);
    if (!existing) return reply.code(404).send(notFound('Subscription', subscriptionKey));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = {
      ...existing,
      ...body,
      status: 'Active',
      suspendedDate: null,
      updatedDate: isoNow(),
    };
    store.set(NS, subscriptionKey, updated);
    return reply.code(200).send({ subscriptionId: subscriptionKey });
  };
}

export function buildListByAccountHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const { accountKey } = req.params as { accountKey: string };
    const query = req.query as Record<string, string>;
    let subs = store.list<Record<string, unknown>>(NS).filter(s => s.accountId === accountKey);
    if (query.status) subs = subs.filter(s => s.status === query.status);
    const pageSize = query.pageSize ? parseInt(query.pageSize, 10) : 20;
    const page = query.page ? parseInt(query.page, 10) : 1;
    const offset = (page - 1) * pageSize;
    const data = subs.slice(offset, offset + pageSize);
    return reply.code(200).send({
      data,
      nextPage: offset + pageSize < subs.length ? page + 1 : null,
    });
  };
}
