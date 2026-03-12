/**
 * Charge override handlers.
 *
 * POST /stripe/v1/charges/:charge/capture  — capture an uncaptured charge
 *
 * Note: most Charge CRUD (list/retrieve/update) is handled by the generated
 * scaffolding. Only the /capture action needs a custom handler.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { stripeError, stripeStateError } from '../stripe-errors.js';

const NS_CH = 'stripe:charges';

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/charges/:charge/capture
 *
 * Captures an uncaptured charge. Supports partial capture.
 */
export function buildCaptureHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { charge } = req.params as { charge: string };
    const ch = store.get<Record<string, unknown>>(NS_CH, charge);
    if (!ch) {
      return reply.code(404).send(stripeError('resource_missing', `No such charge: '${charge}'`));
    }

    if (ch.captured === true) {
      return reply.code(400).send(
        stripeStateError(`Charge ${charge} has already been captured.`, 'charge_already_captured'),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const captureAmount = body.amount != null
      ? Number(body.amount)
      : (ch.amount as number);

    const updated: Record<string, unknown> = {
      ...ch,
      captured: true,
      paid: true,
      status: 'succeeded',
      amount_captured: captureAmount,
    };
    store.set(NS_CH, charge, updated);
    return reply.code(200).send(updated);
  };
}
