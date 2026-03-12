/**
 * Setup Intent state-machine override handlers.
 *
 * Stripe's SetupIntent lifecycle:
 *   requires_payment_method → requires_confirmation → requires_action
 *   → processing → succeeded | canceled
 *
 * These overrides replace the generated "action" stubs for:
 *   POST /stripe/v1/setup_intents/:setup_intent/confirm
 *   POST /stripe/v1/setup_intents/:setup_intent/cancel
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { unixNow } from '@mimicai/adapter-sdk';
import { stripeError, stripeStateError } from '../stripe-errors.js';

const NS_SI = 'stripe:setup_intents';

// ---------------------------------------------------------------------------
// confirm
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/setup_intents/:setup_intent/confirm
 *
 * Confirms the SetupIntent, advancing it to 'succeeded'.
 */
export function buildConfirmHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { intent } = req.params as { intent: string };
    const si = store.get<Record<string, unknown>>(NS_SI, intent);
    if (!si) {
      return reply.code(404).send(stripeError('resource_missing', `No such setup_intent: '${intent}'`));
    }

    const nonConfirmableStatuses = ['succeeded', 'canceled'];
    if (nonConfirmableStatuses.includes(si.status as string)) {
      return reply.code(400).send(
        stripeStateError(
          `This SetupIntent's status is '${si.status}', but it should be ` +
          `requires_payment_method, requires_confirmation, or requires_action.`,
          'setup_intent_unexpected_state',
        ),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated: Record<string, unknown> = {
      ...si,
      ...body,
      id: intent,
      status: 'succeeded',
      payment_method: body.payment_method ?? si.payment_method ?? null,
    };
    store.set(NS_SI, intent, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/setup_intents/:setup_intent/cancel
 *
 * Cancels the SetupIntent. Only cancelable before it succeeds.
 */
export function buildCancelHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { intent } = req.params as { intent: string };
    const si = store.get<Record<string, unknown>>(NS_SI, intent);
    if (!si) {
      return reply.code(404).send(stripeError('resource_missing', `No such setup_intent: '${intent}'`));
    }

    if (si.status === 'succeeded' || si.status === 'canceled') {
      return reply.code(400).send(
        stripeStateError(
          `This SetupIntent's status is '${si.status}'. Only a SetupIntent with ` +
          `one of the following statuses may be canceled: ` +
          `requires_payment_method, requires_confirmation, requires_action, processing.`,
          'setup_intent_unexpected_state',
        ),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated: Record<string, unknown> = {
      ...si,
      status: 'canceled',
      cancellation_reason: body.cancellation_reason ?? 'requested_by_customer',
      canceled_at: unixNow(),
    };
    store.set(NS_SI, intent, updated);
    return reply.code(200).send(updated);
  };
}
