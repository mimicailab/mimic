import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { unixNow, generateId } from '@mimicai/adapter-sdk';
import { chargebeeNotFound, chargebeeStateError } from '../chargebee-errors.js';
import { SCHEMA_DEFAULTS } from '../generated/schemas.js';

const NS = 'chargebee:subscriptions';

export function buildCreateSubscriptionHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const customerId = (req.params as Record<string, string>)['customer_id'];
    const body = (req.body ?? {}) as Record<string, unknown>;
    const factory = SCHEMA_DEFAULTS['subscription']!;
    const id = (body.id as string) || generateId('', 14);
    const now = unixNow();
    const obj = factory({
      id,
      customer_id: customerId,
      created_at: now,
      updated_at: now,
      resource_version: now * 1000,
      ...body,
    });
    store.set(NS, id, obj);
    // This route is under /customers/ so the hook would wrap as {customer:...}.
    // Pre-wrap as {subscription:...} and signal hook to skip via __skipWrap.
    return reply.code(200).send({ subscription: obj, __skipWrap: true });
  };
}

export function buildCancelHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = (req.params as Record<string, string>)['subscription_id'];
    const existing = store.get<Record<string, unknown>>(NS, id!);

    if (!existing) {
      return reply.code(404).send(chargebeeNotFound('subscriptions', id!));
    }

    const status = existing.status as string;
    if (status === 'cancelled' || status === 'non_renewing') {
      return reply.code(400).send(chargebeeStateError(
        `Subscription ${id} is already ${status}, cannot cancel`,
      ));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const endOfTerm = body.end_of_term === true || body.end_of_term === 'true';
    const now = unixNow();

    const updated: Record<string, unknown> = {
      ...existing,
      status: endOfTerm ? 'non_renewing' : 'cancelled',
      cancel_reason: body.cancel_reason_code ?? 'not_paid',
      cancelled_at: endOfTerm ? undefined : now,
      updated_at: now,
      resource_version: now * 1000,
    };

    store.set(NS, id!, updated);
    return reply.code(200).send(updated);
  };
}

export function buildReactivateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = (req.params as Record<string, string>)['subscription_id'];
    const existing = store.get<Record<string, unknown>>(NS, id!);

    if (!existing) {
      return reply.code(404).send(chargebeeNotFound('subscriptions', id!));
    }

    if (existing.status !== 'cancelled' && existing.status !== 'non_renewing') {
      return reply.code(400).send(chargebeeStateError(
        `Subscription ${id} is ${existing.status}, cannot reactivate`,
      ));
    }

    const now = unixNow();
    const updated: Record<string, unknown> = {
      ...existing,
      status: 'active',
      cancelled_at: null,
      cancel_reason: null,
      activated_at: now,
      updated_at: now,
      resource_version: now * 1000,
    };

    store.set(NS, id!, updated);
    return reply.code(200).send(updated);
  };
}

export function buildPauseHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = (req.params as Record<string, string>)['subscription_id'];
    const existing = store.get<Record<string, unknown>>(NS, id!);

    if (!existing) {
      return reply.code(404).send(chargebeeNotFound('subscriptions', id!));
    }

    if (existing.status !== 'active') {
      return reply.code(400).send(chargebeeStateError(
        `Subscription ${id} is ${existing.status}, cannot pause`,
      ));
    }

    const now = unixNow();
    const updated: Record<string, unknown> = {
      ...existing,
      status: 'paused',
      pause_date: now,
      updated_at: now,
      resource_version: now * 1000,
    };

    store.set(NS, id!, updated);
    return reply.code(200).send(updated);
  };
}

export function buildResumeHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = (req.params as Record<string, string>)['subscription_id'];
    const existing = store.get<Record<string, unknown>>(NS, id!);

    if (!existing) {
      return reply.code(404).send(chargebeeNotFound('subscriptions', id!));
    }

    if (existing.status !== 'paused') {
      return reply.code(400).send(chargebeeStateError(
        `Subscription ${id} is ${existing.status}, cannot resume`,
      ));
    }

    const now = unixNow();
    const updated: Record<string, unknown> = {
      ...existing,
      status: 'active',
      pause_date: null,
      resume_date: now,
      updated_at: now,
      resource_version: now * 1000,
    };

    store.set(NS, id!, updated);
    return reply.code(200).send(updated);
  };
}
