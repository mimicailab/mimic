import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { AdyenConfig } from './config.js';
import { adyenError } from './adyen-errors.js';
import { registerAdyenTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  payments: 'adyen_payments',
  sessions: 'adyen_sessions',
  tokens: 'adyen_tokens',
  paymentLinks: 'adyen_payment_links',
  orders: 'adyen_orders',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a 16-digit numeric PSP reference */
function generatePsp(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
}

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Determine resultCode from reference prefix (sandbox testing pattern).
 */
function resultCodeFromReference(reference?: string): string {
  if (!reference) return 'Authorised';
  if (reference.startsWith('DECLINE_')) return 'Refused';
  if (reference.startsWith('REDIRECT_')) return 'RedirectShopper';
  if (reference.startsWith('CHALLENGE_')) return 'ChallengeShopper';
  if (reference.startsWith('PENDING_')) return 'Pending';
  if (reference.startsWith('ERROR_')) return 'Error';
  return 'Authorised';
}

// ---------------------------------------------------------------------------
// Adyen Adapter
// ---------------------------------------------------------------------------

export class AdyenAdapter extends BaseApiMockAdapter<AdyenConfig> {
  readonly id = 'adyen';
  readonly name = 'Adyen API';
  readonly basePath = '/adyen/v71';
  readonly versions = ['v70', 'v71'];
  readonly promptContext = {
    resources: ['payments', 'captures', 'refunds', 'recurring_details', 'payment_methods', 'payouts'],
    amountFormat: 'integer minor units with currency object (e.g. { value: 2999, currency: "USD" })',
    relationships: [
      'capture → payment',
      'refund → payment',
      'recurring_detail → shopper',
      'payout → merchant_account',
    ],
    requiredFields: {
      payments: ['pspReference', 'merchantReference', 'amount', 'status', 'paymentMethod', 'merchantAccountCode', 'createdAt'],
      captures: ['pspReference', 'paymentPspReference', 'amount', 'status', 'merchantAccountCode'],
      refunds: ['pspReference', 'paymentPspReference', 'amount', 'status', 'merchantAccountCode'],
    },
    notes: 'Amounts use {value, currency} object format with value in minor units. Uses pspReference as primary ID. Status: Authorised, Captured, Refused, Cancelled, Error. Timestamps ISO 8601.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    amountFields: ['amount'],
    statusEnums: {
      payments: ['Authorised', 'Captured', 'Refused', 'Cancelled', 'Error'],
    },
    timestampFields: ['createdAt'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerAdyenTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const key = req.headers['x-api-key'];
    if (!key) return null;
    const match = String(key).match(/^AQE([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    const p = this.basePath;

    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    // ── Checkout: Payments ───────────────────────────────────────────────

    server.post(`${p}/payments`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.amount) {
        return reply
          .status(422)
          .send(
            adyenError(422, '14_012', "Required field 'amount' is not provided"),
          );
      }
      if (!body.merchantAccount) {
        return reply
          .status(422)
          .send(
            adyenError(
              422,
              '14_012',
              "Required field 'merchantAccount' is not provided",
            ),
          );
      }

      const pspRef = generatePsp();
      const reference = body.reference as string | undefined;
      const resultCode = resultCodeFromReference(reference);

      const payment: Record<string, unknown> = {
        pspReference: pspRef,
        resultCode,
        amount: body.amount,
        merchantAccount: body.merchantAccount,
        merchantReference: reference ?? null,
        paymentMethod: {
          brand:
            (body.paymentMethod as Record<string, unknown>)?.type || 'visa',
          type: 'scheme',
          lastFour: '1234',
        },
      };

      // Add redirect/challenge action if needed
      if (resultCode === 'RedirectShopper') {
        payment.action = {
          type: 'redirect',
          method: 'GET',
          url: `https://test.adyen.com/hpp/3d/validate.shtml?pspRef=${pspRef}`,
          paymentMethodType: 'scheme',
        };
      } else if (resultCode === 'ChallengeShopper') {
        payment.action = {
          type: 'threeDS2',
          subtype: 'challenge',
          token: generateId('', 32),
          paymentMethodType: 'scheme',
        };
      }

      store.set(NS.payments, pspRef, {
        ...payment,
        status:
          resultCode === 'Authorised'
            ? 'authorised'
            : resultCode.toLowerCase(),
        createdAt: isoNow(),
      });

      return reply.send(payment);
    });

    // ── Checkout: Payment Details (3DS) ──────────────────────────────────

    server.post(`${p}/payments/details`, async (req, reply) => {
      const pspRef = generatePsp();
      const payment = {
        pspReference: pspRef,
        resultCode: 'Authorised',
      };
      store.set(NS.payments, pspRef, {
        ...payment,
        status: 'authorised',
        createdAt: isoNow(),
      });
      return reply.send(payment);
    });

    // ── Checkout: Sessions ───────────────────────────────────────────────

    server.post(`${p}/sessions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.amount || !body.merchantAccount || !body.returnUrl) {
        return reply
          .status(422)
          .send(
            adyenError(
              422,
              '14_012',
              "Required fields 'amount', 'merchantAccount', and 'returnUrl' must be provided",
            ),
          );
      }
      const sessionId = generateId('CS', 32);
      const session = {
        id: sessionId,
        sessionData: generateId('Ab02b4c0!', 64),
        amount: body.amount,
        reference: body.reference ?? null,
        merchantAccount: body.merchantAccount,
        returnUrl: body.returnUrl,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
      store.set(NS.sessions, sessionId, session);
      return reply.status(201).send(session);
    });

    // ── Checkout: Payment Methods ────────────────────────────────────────

    server.post(`${p}/paymentMethods`, async (_req, reply) => {
      return reply.send({
        paymentMethods: [
          {
            name: 'Credit Card',
            type: 'scheme',
            brands: ['visa', 'mc', 'amex'],
          },
          { name: 'PayPal', type: 'paypal' },
          {
            name: 'iDEAL',
            type: 'ideal',
            issuers: [
              { id: 'ing', name: 'ING' },
              { id: 'abn', name: 'ABN AMRO' },
              { id: 'rabo', name: 'Rabobank' },
            ],
          },
          { name: 'Klarna', type: 'klarna' },
          { name: 'Apple Pay', type: 'applepay' },
          { name: 'Google Pay', type: 'googlepay' },
          { name: 'SEPA Direct Debit', type: 'sepadirectdebit' },
          { name: 'Bancontact', type: 'bcmc' },
        ],
      });
    });

    // ── Modifications: Capture ───────────────────────────────────────────

    server.post(`${p}/payments/:pspRef/captures`, async (req, reply) => {
      const { pspRef } = req.params as { pspRef: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const payment = store.get<Record<string, unknown>>(NS.payments, pspRef);
      if (!payment) {
        return reply
          .status(422)
          .send(adyenError(422, '14_012', `Original payment not found: ${pspRef}`));
      }
      store.update(NS.payments, pspRef, { status: 'captured' });
      return reply.send({
        pspReference: generatePsp(),
        paymentPspReference: pspRef,
        amount: body.amount ?? payment.amount,
        merchantAccount: body.merchantAccount ?? payment.merchantAccount,
        status: 'received',
      });
    });

    // ── Modifications: Refund ────────────────────────────────────────────

    server.post(`${p}/payments/:pspRef/refunds`, async (req, reply) => {
      const { pspRef } = req.params as { pspRef: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const payment = store.get<Record<string, unknown>>(NS.payments, pspRef);
      if (!payment) {
        return reply
          .status(422)
          .send(adyenError(422, '14_012', `Original payment not found: ${pspRef}`));
      }
      return reply.send({
        pspReference: generatePsp(),
        paymentPspReference: pspRef,
        amount: body.amount ?? payment.amount,
        merchantAccount: body.merchantAccount ?? payment.merchantAccount,
        status: 'received',
      });
    });

    // ── Modifications: Cancel ────────────────────────────────────────────

    server.post(`${p}/payments/:pspRef/cancels`, async (req, reply) => {
      const { pspRef } = req.params as { pspRef: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const payment = store.get<Record<string, unknown>>(NS.payments, pspRef);
      if (!payment) {
        return reply
          .status(422)
          .send(adyenError(422, '14_012', `Original payment not found: ${pspRef}`));
      }
      store.update(NS.payments, pspRef, { status: 'cancelled' });
      return reply.send({
        pspReference: generatePsp(),
        paymentPspReference: pspRef,
        merchantAccount: body.merchantAccount ?? payment.merchantAccount,
        status: 'received',
      });
    });

    // ── Modifications: Reversal ──────────────────────────────────────────

    server.post(`${p}/payments/:pspRef/reversals`, async (req, reply) => {
      const { pspRef } = req.params as { pspRef: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const payment = store.get<Record<string, unknown>>(NS.payments, pspRef);
      if (!payment) {
        return reply
          .status(422)
          .send(adyenError(422, '14_012', `Original payment not found: ${pspRef}`));
      }
      store.update(NS.payments, pspRef, { status: 'reversed' });
      return reply.send({
        pspReference: generatePsp(),
        paymentPspReference: pspRef,
        merchantAccount: body.merchantAccount ?? payment.merchantAccount,
        status: 'received',
      });
    });

    // ── Modifications: Amount Update ─────────────────────────────────────

    server.post(`${p}/payments/:pspRef/amountUpdates`, async (req, reply) => {
      const { pspRef } = req.params as { pspRef: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const payment = store.get<Record<string, unknown>>(NS.payments, pspRef);
      if (!payment) {
        return reply
          .status(422)
          .send(adyenError(422, '14_012', `Original payment not found: ${pspRef}`));
      }
      store.update(NS.payments, pspRef, { amount: body.amount });
      return reply.send({
        pspReference: generatePsp(),
        paymentPspReference: pspRef,
        amount: body.amount,
        merchantAccount: body.merchantAccount ?? payment.merchantAccount,
        status: 'received',
      });
    });

    // ── Tokenization: Stored Payment Methods ─────────────────────────────

    server.post(`${p}/storedPaymentMethods`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = {
        id: generateId('', 16),
        type: 'scheme',
        brand: (body.paymentMethod as Record<string, unknown>)?.brand ?? 'visa',
        lastFour: '1234',
        expiryMonth: '03',
        expiryYear: '2028',
        holderName: body.holderName ?? null,
        shopperReference: body.shopperReference ?? null,
        merchantAccount: body.merchantAccount ?? null,
      };
      store.set(NS.tokens, token.id, token);
      return reply.status(201).send(token);
    });

    server.get(`${p}/storedPaymentMethods`, async (req, reply) => {
      const q = req.query as Record<string, string>;
      let tokens = store.list<Record<string, unknown>>(NS.tokens);
      if (q.shopperReference) {
        tokens = tokens.filter(
          (t) => t.shopperReference === q.shopperReference,
        );
      }
      if (q.merchantAccount) {
        tokens = tokens.filter(
          (t) => t.merchantAccount === q.merchantAccount,
        );
      }
      return reply.send({ storedPaymentMethods: tokens });
    });

    server.delete(`${p}/storedPaymentMethods/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const token = store.get(NS.tokens, id);
      if (!token) {
        return reply
          .status(422)
          .send(adyenError(422, '14_012', `Stored payment method not found: ${id}`));
      }
      store.delete(NS.tokens, id);
      return reply.status(204).send();
    });

    // ── Payouts ──────────────────────────────────────────────────────────

    server.post(`${p}/payouts`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      return reply.send({
        pspReference: generatePsp(),
        resultCode: '[payout-submit-received]',
        amount: body.amount,
      });
    });

    // ── Payment Links ────────────────────────────────────────────────────

    server.post(`${p}/paymentLinks`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.amount) {
        return reply
          .status(422)
          .send(
            adyenError(422, '14_012', "Required field 'amount' is not provided"),
          );
      }
      const linkId = generateId('PL', 24);
      const link = {
        id: linkId,
        url: `https://test.adyen.link/${linkId}`,
        amount: body.amount,
        reference: body.reference ?? null,
        merchantAccount: body.merchantAccount ?? null,
        description: body.description ?? null,
        status: 'active',
        expiresAt:
          body.expiresAt ||
          new Date(Date.now() + 86400_000).toISOString(),
        createdAt: isoNow(),
      };
      store.set(NS.paymentLinks, linkId, link);
      return reply.status(201).send(link);
    });

    server.get(`${p}/paymentLinks/:linkId`, async (req, reply) => {
      const { linkId } = req.params as { linkId: string };
      const link = store.get(NS.paymentLinks, linkId);
      if (!link) {
        return reply
          .status(422)
          .send(adyenError(422, '14_012', 'PaymentLink not found'));
      }
      return reply.send(link);
    });

    server.patch(`${p}/paymentLinks/:linkId`, async (req, reply) => {
      const { linkId } = req.params as { linkId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const link = store.get<Record<string, unknown>>(NS.paymentLinks, linkId);
      if (!link) {
        return reply
          .status(422)
          .send(adyenError(422, '14_012', 'PaymentLink not found'));
      }
      const updated = { ...link, ...body };
      store.set(NS.paymentLinks, linkId, updated);
      return reply.send(updated);
    });

    // ── Orders ───────────────────────────────────────────────────────────

    server.post(`${p}/orders`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.amount) {
        return reply
          .status(422)
          .send(
            adyenError(422, '14_012', "Required field 'amount' is not provided"),
          );
      }
      const pspRef = generatePsp();
      const order = {
        pspReference: pspRef,
        orderData: generateId('Ab02b4c0!', 64),
        amount: body.amount,
        remainingAmount: body.amount,
        reference: body.reference ?? null,
        merchantAccount: body.merchantAccount ?? null,
        resultCode: 'Success',
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      };
      store.set(NS.orders, pspRef, order);
      return reply.status(201).send(order);
    });

    server.post(`${p}/orders/cancel`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const orderBody = body.order as Record<string, unknown> | undefined;
      const pspRef = orderBody?.pspReference as string | undefined;
      if (pspRef) {
        store.update(NS.orders, pspRef, { status: 'cancelled' });
      }
      return reply.send({
        pspReference: generatePsp(),
        resultCode: 'Cancelled',
      });
    });

    // ── Donations ────────────────────────────────────────────────────────

    server.post(`${p}/donations`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      return reply.send({
        pspReference: generatePsp(),
        status: 'completed',
        amount: body.amount,
        donationAccount: body.donationAccount ?? 'CHARITY_ACCOUNT',
      });
    });

    // ── Card Details ─────────────────────────────────────────────────────

    server.post(`${p}/cardDetails`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const cardNumber = body.cardNumber as string | undefined;
      let brand = 'visa';
      if (cardNumber?.startsWith('5')) brand = 'mc';
      if (cardNumber?.startsWith('3')) brand = 'amex';
      return reply.send({
        brands: [
          {
            type: brand,
            supported: true,
            cvcPolicy: 'required',
            expiryDatePolicy: 'required',
            panLength: 16,
          },
        ],
      });
    });

    // ── Apple Pay Sessions ───────────────────────────────────────────────

    server.post(`${p}/applePay/sessions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      return reply.send({
        epochTimestamp: Date.now(),
        expiresAt: Date.now() + 300_000,
        merchantSessionIdentifier: generateId('SSH', 32),
        nonce: generateId('', 16),
        merchantIdentifier: body.merchantIdentifier ?? 'merchant.com.test',
        domainName: body.domainName ?? 'example.com',
        displayName: body.displayName ?? 'Test Store',
        signature: generateId('', 64),
        operationalAnalyticsIdentifier: generateId('', 16),
        retries: 0,
        pspId: generateId('', 8),
      });
    });
  }

  getEndpoints(): EndpointDefinition[] {
    const p = this.basePath;
    return [
      // Checkout
      { method: 'POST', path: `${p}/payments`, description: 'Create payment' },
      { method: 'POST', path: `${p}/payments/details`, description: 'Submit 3DS/redirect details' },
      { method: 'POST', path: `${p}/sessions`, description: 'Create Drop-in session' },
      { method: 'POST', path: `${p}/paymentMethods`, description: 'Get available payment methods' },

      // Modifications
      { method: 'POST', path: `${p}/payments/:pspRef/captures`, description: 'Capture payment' },
      { method: 'POST', path: `${p}/payments/:pspRef/refunds`, description: 'Refund payment' },
      { method: 'POST', path: `${p}/payments/:pspRef/cancels`, description: 'Cancel payment' },
      { method: 'POST', path: `${p}/payments/:pspRef/reversals`, description: 'Reverse payment' },
      { method: 'POST', path: `${p}/payments/:pspRef/amountUpdates`, description: 'Update payment amount' },

      // Tokenization
      { method: 'POST', path: `${p}/storedPaymentMethods`, description: 'Create stored payment method' },
      { method: 'GET', path: `${p}/storedPaymentMethods`, description: 'List stored payment methods' },
      { method: 'DELETE', path: `${p}/storedPaymentMethods/:id`, description: 'Delete stored payment method' },

      // Payouts
      { method: 'POST', path: `${p}/payouts`, description: 'Instant payout' },

      // Payment Links
      { method: 'POST', path: `${p}/paymentLinks`, description: 'Create payment link' },
      { method: 'GET', path: `${p}/paymentLinks/:linkId`, description: 'Get payment link' },
      { method: 'PATCH', path: `${p}/paymentLinks/:linkId`, description: 'Update payment link' },

      // Orders
      { method: 'POST', path: `${p}/orders`, description: 'Create order' },
      { method: 'POST', path: `${p}/orders/cancel`, description: 'Cancel order' },

      // Additional
      { method: 'POST', path: `${p}/donations`, description: 'Make a donation' },
      { method: 'POST', path: `${p}/cardDetails`, description: 'Get card details' },
      { method: 'POST', path: `${p}/applePay/sessions`, description: 'Create Apple Pay session' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    payments: NS.payments,
    sessions: NS.sessions,
    tokens: NS.tokens,
    payment_links: NS.paymentLinks,
    orders: NS.orders,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const adyenData = expanded.apiResponses?.adyen;
      if (!adyenData) continue;

      for (const [resourceType, responses] of Object.entries(
        adyenData.responses,
      )) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const key =
            (body.pspReference as string) ??
            (body.id as string);
          if (!key) continue;

          store.set(namespace, String(key), {
            createdAt: isoNow(),
            ...body,
          });
        }
      }
    }
  }
}
