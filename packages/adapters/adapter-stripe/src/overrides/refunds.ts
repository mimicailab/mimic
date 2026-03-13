/**
 * Refund override handlers.
 *
 * The generic CRUD scaffold creates refund objects but never updates the parent
 * charge's `amount_refunded` / `refunded` fields. These overrides fix that.
 *
 *   POST /stripe/v1/refunds              — create refund, sync charge state
 *   POST /stripe/v1/refunds/:refund/cancel — cancel pending refund, reverse charge state
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/core';
import { unixNow } from '@mimicai/adapter-sdk';
import { stripeError, stripeStateError } from '../stripe-errors.js';

const NS_RE = 'stripe:refunds';
const NS_CH = 'stripe:charges';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function syncChargeRefundState(
  store: StateStore,
  chargeId: string,
  refundAmount: number,
  delta: 1 | -1, // +1 on refund create, -1 on refund cancel
): void {
  const charge = store.get<Record<string, unknown>>(NS_CH, chargeId);
  if (!charge) return; // charge not in store — mock is lenient, skip sync

  const current = (charge.amount_refunded as number) ?? 0;
  const total = (charge.amount as number) ?? 0;
  const newRefunded = Math.max(0, current + delta * refundAmount);

  store.set(NS_CH, chargeId, {
    ...charge,
    amount_refunded: newRefunded,
    refunded: newRefunded >= total,
  });
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/refunds
 *
 * Creates a refund and syncs `amount_refunded` / `refunded` on the parent
 * charge (if the charge exists in the StateStore).
 *
 * Resolves charge from:
 *   1. body.charge (direct charge ID)
 *   2. body.payment_intent → find associated charge in store
 */
export function buildCreateHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const amount = Number(body.amount ?? 0);

    // Resolve the charge ID
    let chargeId = body.charge as string | undefined;
    if (!chargeId && body.payment_intent) {
      const piId = body.payment_intent as string;
      const charge = store.list<Record<string, unknown>>(NS_CH)
        .find(c => c.payment_intent === piId);
      chargeId = charge?.id as string | undefined;
    }

    const refundId = generateId('re_', 14);
    const refund: Record<string, unknown> = {
      id: refundId,
      object: 'refund',
      amount,
      charge: chargeId ?? null,
      payment_intent: body.payment_intent ?? null,
      currency: body.currency ?? 'usd',
      reason: body.reason ?? null,
      status: 'succeeded',
      created: unixNow(),
      metadata: (body.metadata as Record<string, unknown>) ?? {},
      balance_transaction: null,
      description: body.description ?? null,
      failure_balance_transaction: null,
      failure_reason: null,
      instructions_email: null,
      receipt_number: null,
      source_transfer_reversal: null,
      transfer_reversal: null,
    };

    store.set(NS_RE, refundId, refund);

    if (chargeId) {
      syncChargeRefundState(store, chargeId, amount, 1);
    }

    return reply.code(200).send(refund);
  };
}

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/refunds/:refund/cancel
 *
 * Cancels a pending refund and reverses the charge's `amount_refunded`.
 */
export function buildCancelHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { refund: refundId } = req.params as { refund: string };
    const refund = store.get<Record<string, unknown>>(NS_RE, refundId);
    if (!refund) {
      return reply.code(404).send(stripeError('resource_missing', `No such refund: '${refundId}'`));
    }

    if (refund.status !== 'pending') {
      return reply.code(400).send(
        stripeStateError(
          `This refund's status is '${refund.status}'. Only pending refunds can be canceled.`,
          'charge_already_refunded',
        ),
      );
    }

    const updated: Record<string, unknown> = {
      ...refund,
      status: 'canceled',
    };
    store.set(NS_RE, refundId, updated);

    // Reverse the charge sync
    const chargeId = refund.charge as string | undefined;
    if (chargeId) {
      syncChargeRefundState(store, chargeId, refund.amount as number, -1);
    }

    return reply.code(200).send(updated);
  };
}
