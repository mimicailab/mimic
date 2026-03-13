/**
 * Billing Portal override handlers.
 *
 * POST /stripe/v1/billing_portal/sessions  — create a portal session (stateless, no ID)
 *
 * Billing portal sessions are ephemeral — they have an expiry and a URL but
 * are not retrieved by ID after creation. The generated scaffold would try to
 * use a StateStore namespace which is unnecessary here.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/core';
import { unixNow } from '@mimicai/adapter-sdk';

// ---------------------------------------------------------------------------
// create session
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/billing_portal/sessions
 *
 * Creates a billing portal session. Returns a URL where the customer can
 * manage their subscription.
 */
export function buildCreateSessionHandler(_store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const now = unixNow();

    const session: Record<string, unknown> = {
      id: generateId('bps_', 14),
      object: 'billing_portal.session',
      configuration: body.configuration ?? null,
      created: now,
      customer: body.customer ?? null,
      flow: null,
      livemode: false,
      locale: body.locale ?? null,
      on_behalf_of: null,
      return_url: body.return_url ?? null,
      url: `https://billing.stripe.com/p/session/${generateId('', 32)}`,
    };

    return reply.code(200).send(session);
  };
}
