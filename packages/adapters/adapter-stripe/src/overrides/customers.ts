/**
 * Customer override handlers.
 *
 * The generic DELETE scaffold removes the customer from the StateStore but
 * leaves linked subscriptions untouched (orphaned with status 'active').
 * This override cascades the deletion by canceling all customer subscriptions.
 *
 *   DELETE /stripe/v1/customers/:customer — cascade-cancel subscriptions
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { unixNow } from '@mimicai/adapter-sdk';
import { stripeError } from '../stripe-errors.js';

const NS_CUS = 'stripe:customers';
const NS_SUB = 'stripe:subscriptions';

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

/**
 * DELETE /stripe/v1/customers/:customer
 *
 * Deletes a customer and cancels all of their active subscriptions.
 */
export function buildDeleteHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { customer: customerId } = req.params as { customer: string };
    const customer = store.get<Record<string, unknown>>(NS_CUS, customerId);
    if (!customer) {
      return reply.code(404).send(stripeError('resource_missing', `No such customer: '${customerId}'`));
    }

    // Cascade: cancel all subscriptions belonging to this customer
    const now = unixNow();
    const subs = store.list<Record<string, unknown>>(NS_SUB)
      .filter(s => s.customer === customerId && s.status !== 'canceled');

    for (const sub of subs) {
      store.set(NS_SUB, sub.id as string, {
        ...sub,
        status: 'canceled',
        canceled_at: now,
      });
    }

    store.delete(NS_CUS, customerId);
    return reply.code(200).send({ id: customerId, object: 'customer', deleted: true });
  };
}
