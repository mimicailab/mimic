/**
 * Invoice state-machine override handlers.
 *
 * Stripe's Invoice lifecycle:
 *   draft → open → paid | uncollectible | void
 *
 * Finalize transitions: draft → open
 * Pay transitions:      open  → paid
 * Void transitions:     open  → void
 * Mark uncollectible:   open  → uncollectible
 *
 * These overrides replace the generated "action" stubs for:
 *   POST /stripe/v1/invoices/:invoice/finalize
 *   POST /stripe/v1/invoices/:invoice/pay
 *   POST /stripe/v1/invoices/:invoice/void
 *   POST /stripe/v1/invoices/:invoice/mark_uncollectible
 *   POST /stripe/v1/invoices (special: "upcoming" invoice handling)
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/core';
import { unixNow } from '@mimicai/adapter-sdk';
import { stripeError, stripeStateError } from '../stripe-errors.js';

const NS_INV = 'stripe:invoices';
const NS_CH = 'stripe:charges';
const NS_PI = 'stripe:payment_intents';

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/invoices/:invoice/finalize
 *
 * Transitions a draft invoice to open status.
 */
export function buildFinalizeHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { invoice } = req.params as { invoice: string };
    const inv = store.get<Record<string, unknown>>(NS_INV, invoice);
    if (!inv) {
      return reply.code(404).send(stripeError('resource_missing', `No such invoice: '${invoice}'`));
    }

    if (inv.status !== 'draft') {
      return reply.code(400).send(
        stripeStateError(
          `This invoice's status is '${inv.status}'. Only draft invoices can be finalized.`,
          'invoice_finalization_error',
        ),
      );
    }

    const now = unixNow();
    const updated: Record<string, unknown> = {
      ...inv,
      status: 'open',
      finalized_at: now,
      due_date: inv.due_date ?? now + 30 * 86400,
      hosted_invoice_url: `https://invoice.stripe.com/i/acct_mock/${invoice}`,
      invoice_pdf: `https://pay.stripe.com/invoice/acct_mock/${invoice}/pdf`,
    };
    store.set(NS_INV, invoice, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// pay
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/invoices/:invoice/pay
 *
 * Pays an open invoice. Creates a Charge and optional PaymentIntent record.
 */
export function buildPayHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { invoice } = req.params as { invoice: string };
    let inv = store.get<Record<string, unknown>>(NS_INV, invoice);
    if (!inv) {
      return reply.code(404).send(stripeError('resource_missing', `No such invoice: '${invoice}'`));
    }

    // Auto-finalize draft invoices before paying (mirrors Stripe's real behavior)
    if (inv.status === 'draft') {
      const finalized: Record<string, unknown> = {
        ...inv,
        status: 'open',
        finalized_at: unixNow(),
        due_date: (inv.due_date as number | null) ?? unixNow() + 30 * 86400,
        hosted_invoice_url: `https://invoice.stripe.com/i/acct_mock/${invoice}`,
        invoice_pdf: `https://pay.stripe.com/invoice/acct_mock/${invoice}/pdf`,
      };
      store.set(NS_INV, invoice, finalized);
      inv = finalized;
    }

    if (inv.status !== 'open') {
      return reply.code(400).send(
        stripeStateError(
          `This invoice's status is '${inv.status}'. Only draft or open invoices can be paid.`,
          'invoice_payment_error',
        ),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const now = unixNow();
    const amount = (inv.amount_due as number) ?? 0;

    // Create a charge for the payment
    const chargeId = generateId('ch_', 24);
    const charge: Record<string, unknown> = {
      id: chargeId,
      object: 'charge',
      amount,
      amount_captured: amount,
      amount_refunded: 0,
      currency: inv.currency ?? 'usd',
      customer: inv.customer ?? null,
      description: `Invoice ${invoice}`,
      captured: true,
      paid: true,
      refunded: false,
      status: 'succeeded',
      payment_method: body.payment_method ?? inv.default_payment_method ?? null,
      invoice: invoice,
      livemode: false,
      metadata: {},
      created: now,
    };
    store.set(NS_CH, chargeId, charge);

    const updated: Record<string, unknown> = {
      ...inv,
      status: 'paid',
      paid: true,
      paid_at: now,
      amount_paid: amount,
      amount_remaining: 0,
      charge: chargeId,
      payment_intent: inv.payment_intent ?? null,
    };
    store.set(NS_INV, invoice, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// void
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/invoices/:invoice/void
 *
 * Voids an open invoice.
 */
export function buildVoidHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { invoice } = req.params as { invoice: string };
    const inv = store.get<Record<string, unknown>>(NS_INV, invoice);
    if (!inv) {
      return reply.code(404).send(stripeError('resource_missing', `No such invoice: '${invoice}'`));
    }

    if (inv.status !== 'open') {
      return reply.code(400).send(
        stripeStateError(
          `This invoice's status is '${inv.status}'. Only open invoices can be voided.`,
          'invoice_action_not_allowed',
        ),
      );
    }

    const updated: Record<string, unknown> = {
      ...inv,
      status: 'void',
      voided_at: unixNow(),
    };
    store.set(NS_INV, invoice, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// mark_uncollectible
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/invoices/:invoice/mark_uncollectible
 *
 * Marks an open invoice as uncollectible.
 */
export function buildMarkUncollectibleHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { invoice } = req.params as { invoice: string };
    const inv = store.get<Record<string, unknown>>(NS_INV, invoice);
    if (!inv) {
      return reply.code(404).send(stripeError('resource_missing', `No such invoice: '${invoice}'`));
    }

    if (inv.status !== 'open') {
      return reply.code(400).send(
        stripeStateError(
          `This invoice's status is '${inv.status}'. Only open invoices can be marked uncollectible.`,
          'invoice_action_not_allowed',
        ),
      );
    }

    const updated: Record<string, unknown> = { ...inv, status: 'uncollectible' };
    store.set(NS_INV, invoice, updated);
    return reply.code(200).send(updated);
  };
}

// ---------------------------------------------------------------------------
// send_invoice (sends a mock "email" — just marks invoice as sent)
// ---------------------------------------------------------------------------

/**
 * POST /stripe/v1/invoices/:invoice/send
 */
export function buildSendHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { invoice } = req.params as { invoice: string };
    const inv = store.get<Record<string, unknown>>(NS_INV, invoice);
    if (!inv) {
      return reply.code(404).send(stripeError('resource_missing', `No such invoice: '${invoice}'`));
    }
    // Finalize if still draft (Stripe auto-finalizes on send)
    let current = inv;
    if (inv.status === 'draft') {
      current = { ...inv, status: 'open', finalized_at: unixNow() };
      store.set(NS_INV, invoice, current);
    }
    return reply.code(200).send(current);
  };
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

/**
 * DELETE /stripe/v1/invoices/:invoice
 *
 * Only draft invoices can be deleted. Open, paid, void, and uncollectible
 * invoices must be voided first.
 */
export function buildDeleteHandler(store: StateStore) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { invoice } = req.params as { invoice: string };
    const inv = store.get<Record<string, unknown>>(NS_INV, invoice);
    if (!inv) {
      return reply.code(404).send(stripeError('resource_missing', `No such invoice: '${invoice}'`));
    }

    if (inv.status !== 'draft') {
      return reply.code(400).send(
        stripeStateError(
          `This invoice's status is '${inv.status}'. Only draft invoices can be deleted.`,
          'invoice_not_editable',
        ),
      );
    }

    store.delete(NS_INV, invoice);
    return reply.code(200).send({ id: invoice, object: 'invoice', deleted: true });
  };
}
