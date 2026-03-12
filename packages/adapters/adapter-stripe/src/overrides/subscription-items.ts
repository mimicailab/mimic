/**
 * SubscriptionItem override handlers.
 *
 * The generic CRUD scaffold creates/deletes subscription_item records as
 * standalone objects without updating the parent subscription's `items.data`
 * array. These overrides keep the parent subscription in sync.
 *
 *   POST   /stripe/v1/subscription_items       — create item + append to subscription
 *   DELETE /stripe/v1/subscription_items/:item — delete item + remove from subscription
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/core';
import { unixNow } from '@mimicai/adapter-sdk';
import { stripeError } from '../stripe-errors.js';

const NS_SI = 'stripe:subscription_items';
const NS_SUB = 'stripe:subscriptions';

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/subscription_items
 *
 * Creates a new SubscriptionItem and appends it to the parent subscription's
 * `items.data` list.
 */
export function buildCreateHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const subId = body.subscription as string | undefined;

    if (!subId) {
      return reply.code(400).send(stripeError('parameter_missing', 'Missing required param: subscription'));
    }

    const sub = store.get<Record<string, unknown>>(NS_SUB, subId);
    if (!sub) {
      return reply.code(404).send(stripeError('resource_missing', `No such subscription: '${subId}'`));
    }

    const itemId = generateId('si_', 14);
    const item: Record<string, unknown> = {
      id: itemId,
      object: 'subscription_item',
      created: unixNow(),
      metadata: (body.metadata as Record<string, unknown>) ?? {},
      price: body.price ?? null,
      quantity: body.quantity ?? 1,
      subscription: subId,
      tax_rates: [],
      billing_thresholds: null,
      discounts: [],
    };

    store.set(NS_SI, itemId, item);

    // Append to subscription.items.data
    const existingItems = sub.items as Record<string, unknown> | undefined;
    const existingData = (existingItems?.data as unknown[]) ?? [];
    const updatedSub: Record<string, unknown> = {
      ...sub,
      items: {
        object: 'list',
        data: [...existingData, item],
        has_more: false,
        url: '/v1/subscription_items',
      },
    };
    store.set(NS_SUB, subId, updatedSub);

    return reply.code(200).send(item);
  };
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

/**
 * DELETE /stripe/v1/subscription_items/:item
 *
 * Deletes a SubscriptionItem and removes it from the parent subscription's
 * `items.data` list.
 */
export function buildDeleteHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { item: itemId } = req.params as { item: string };
    const item = store.get<Record<string, unknown>>(NS_SI, itemId);
    if (!item) {
      return reply.code(404).send(stripeError('resource_missing', `No such subscription_item: '${itemId}'`));
    }

    const subId = item.subscription as string | undefined;
    store.delete(NS_SI, itemId);

    // Remove from subscription.items.data
    if (subId) {
      const sub = store.get<Record<string, unknown>>(NS_SUB, subId);
      if (sub) {
        const existingItems = sub.items as Record<string, unknown> | undefined;
        const existingData = (existingItems?.data as Record<string, unknown>[]) ?? [];
        const updatedSub: Record<string, unknown> = {
          ...sub,
          items: {
            object: 'list',
            data: existingData.filter(i => i.id !== itemId),
            has_more: false,
            url: '/v1/subscription_items',
          },
        };
        store.set(NS_SUB, subId, updatedSub);
      }
    }

    return reply.code(200).send({ id: itemId, object: 'subscription_item', deleted: true });
  };
}
