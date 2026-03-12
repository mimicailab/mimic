/**
 * PaymentMethod override handlers.
 *
 * The generic CRUD scaffold treats attach/detach as create operations, which
 * creates new objects instead of mutating the existing PaymentMethod. These
 * overrides fix that by updating the existing PM's `customer` field in place.
 *
 *   POST /stripe/v1/payment_methods/:payment_method/attach  — set customer field
 *   POST /stripe/v1/payment_methods/:payment_method/detach  — clear customer field
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { stripeError, stripeStateError } from '../stripe-errors.js';

const NS_PM = 'stripe:payment_methods';

// ---------------------------------------------------------------------------
// attach
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/payment_methods/:payment_method/attach
 *
 * Associates an existing PaymentMethod with a Customer by setting its
 * `customer` field. Returns the updated PaymentMethod (not a new object).
 */
export function buildAttachHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { payment_method: pmId } = req.params as { payment_method: string };
    const pm = store.get<Record<string, unknown>>(NS_PM, pmId);
    if (!pm) {
      return reply.code(404).send(stripeError('resource_missing', `No such payment_method: '${pmId}'`));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated: Record<string, unknown> = {
      ...pm,
      customer: body.customer ?? pm.customer,
    };
    store.set(NS_PM, pmId, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// detach
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/payment_methods/:payment_method/detach
 *
 * Removes the association between a PaymentMethod and its Customer by
 * clearing the `customer` field. Returns the updated PaymentMethod.
 */
export function buildDetachHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { payment_method: pmId } = req.params as { payment_method: string };
    const pm = store.get<Record<string, unknown>>(NS_PM, pmId);
    if (!pm) {
      return reply.code(404).send(stripeError('resource_missing', `No such payment_method: '${pmId}'`));
    }

    if (!pm.customer) {
      return reply.code(400).send(
        stripeStateError(
          'This PaymentMethod is not attached to any Customer.',
          'payment_method_not_attached',
        ),
      );
    }

    const updated: Record<string, unknown> = { ...pm, customer: null };
    store.set(NS_PM, pmId, updated);
    return reply.code(200).send(updated);
  };
}
