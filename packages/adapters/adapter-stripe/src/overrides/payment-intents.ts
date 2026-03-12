/**
 * Payment Intent state-machine override handlers.
 *
 * Stripe's PaymentIntent lifecycle:
 *   requires_payment_method → requires_confirmation → requires_action
 *   → processing → succeeded | canceled | requires_capture
 *
 * Manual capture flow:
 *   ... → requires_capture → succeeded (via /capture)
 *
 * These overrides replace the generated "action" stubs for:
 *   POST /stripe/v1/payment_intents/:payment_intent/confirm
 *   POST /stripe/v1/payment_intents/:payment_intent/capture
 *   POST /stripe/v1/payment_intents/:payment_intent/cancel
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/core';
import { unixNow } from '@mimicai/adapter-sdk';
import { stripeError, stripeStateError } from '../stripe-errors.js';

// Namespace for payment intents + charges in the StateStore
const NS_PI = 'stripe:payment_intents';
const NS_CH = 'stripe:charges';

// ---------------------------------------------------------------------------
// confirm
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/payment_intents/:payment_intent/confirm
 *
 * Simulates the payment capture flow:
 *  - automatic capture  → creates a Charge, advances PI to 'succeeded'
 *  - manual capture     → advances PI to 'requires_capture'
 *
 * Realistic terminal states per Stripe's documentation.
 */
export function buildConfirmHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { intent } = req.params as { intent: string };
    const pi = store.get<Record<string, unknown>>(NS_PI, intent);
    if (!pi) {
      return reply.code(404).send(stripeError('resource_missing', `No such payment_intent: '${intent}'`));
    }

    const nonConfirmableStatuses = ['succeeded', 'canceled'];
    if (nonConfirmableStatuses.includes(pi.status as string)) {
      return reply.code(400).send(
        stripeStateError(
          `This PaymentIntent's status is '${pi.status}', but it should be ` +
          `requires_payment_method, requires_confirmation, or requires_action.`,
          'payment_intent_unexpected_state',
        ),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const captureMethod = (body.capture_method ?? pi.capture_method ?? 'automatic') as string;
    const now = unixNow();

    // Always create a Charge on confirm — uncaptured for manual, captured for automatic
    const isManual = captureMethod === 'manual';
    const chargeId = generateId('ch_', 24);
    const charge: Record<string, unknown> = {
      id: chargeId,
      object: 'charge',
      amount: pi.amount,
      amount_captured: isManual ? 0 : pi.amount,
      amount_refunded: 0,
      currency: pi.currency,
      customer: pi.customer ?? null,
      description: pi.description ?? null,
      captured: !isManual,
      paid: !isManual,
      refunded: false,
      status: isManual ? 'pending' : 'succeeded',
      payment_intent: intent,
      payment_method: body.payment_method ?? pi.payment_method ?? null,
      billing_details: body.billing_details ?? {
        address: { city: null, country: null, line1: null, line2: null, postal_code: null, state: null },
        email: null,
        name: null,
        phone: null,
      },
      receipt_url: null,
      livemode: false,
      metadata: pi.metadata ?? {},
      created: now,
    };
    store.set(NS_CH, chargeId, charge);

    const newStatus = isManual ? 'requires_capture' : 'succeeded';

    const updated: Record<string, unknown> = {
      ...pi,
      ...body,
      id: intent,
      status: newStatus,
      capture_method: captureMethod,
      latest_charge: chargeId ?? pi.latest_charge ?? null,
      payment_method: body.payment_method ?? pi.payment_method ?? null,
    };
    store.set(NS_PI, intent, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/payment_intents/:payment_intent/capture
 *
 * Captures a previously authorized PaymentIntent in 'requires_capture' state.
 * Supports partial capture via `amount_to_capture`.
 */
export function buildCaptureHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { intent } = req.params as { intent: string };
    const pi = store.get<Record<string, unknown>>(NS_PI, intent);
    if (!pi) {
      return reply.code(404).send(stripeError('resource_missing', `No such payment_intent: '${intent}'`));
    }

    if (pi.status !== 'requires_capture') {
      return reply.code(400).send(
        stripeStateError(
          `This PaymentIntent's status is '${pi.status}', but it must be requires_capture to capture.`,
          'payment_intent_unexpected_state',
        ),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const capturedAmount = body.amount_to_capture != null
      ? Number(body.amount_to_capture)
      : (pi.amount as number);

    const updated: Record<string, unknown> = {
      ...pi,
      status: 'succeeded',
      amount_captured: capturedAmount,
    };
    store.set(NS_PI, intent, updated);

    // Update the existing charge's amount_captured if it exists
    const existingChargeId = pi.latest_charge as string | undefined;
    if (existingChargeId) {
      const charge = store.get<Record<string, unknown>>(NS_CH, existingChargeId);
      if (charge) {
        store.set(NS_CH, existingChargeId, { ...charge, amount_captured: capturedAmount, captured: true });
      }
    }

    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/payment_intents/:payment_intent/cancel
 *
 * Cancels a PaymentIntent. Only cancelable in certain states.
 */
export function buildCancelHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { intent } = req.params as { intent: string };
    const pi = store.get<Record<string, unknown>>(NS_PI, intent);
    if (!pi) {
      return reply.code(404).send(stripeError('resource_missing', `No such payment_intent: '${intent}'`));
    }

    if (pi.status === 'succeeded' || pi.status === 'canceled') {
      return reply.code(400).send(
        stripeStateError(
          `This PaymentIntent's status is '${pi.status}'. Only a PaymentIntent with ` +
          `one of the following statuses may be canceled: ` +
          `requires_payment_method, requires_capture, requires_confirmation, requires_action, processing.`,
          'payment_intent_unexpected_state',
        ),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated: Record<string, unknown> = {
      ...pi,
      status: 'canceled',
      cancellation_reason: body.cancellation_reason ?? 'requested_by_customer',
      canceled_at: unixNow(),
    };
    store.set(NS_PI, intent, updated);
    return reply.code(200).send(updated);
  };
}
