import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec, AdapterResourceSpecs } from '@mimicai/core';
import { derivePromptContext, deriveDataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId, unixNow } from '@mimicai/adapter-sdk';
import type { StripeConfig } from './config.js';
import { stripeError } from './stripe-errors.js';
import { registerStripeTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  customers: 'stripe_customers',
  pis: 'stripe_pis',
  charges: 'stripe_charges',
  subs: 'stripe_subs',
  invoices: 'stripe_invoices',
  invoiceItems: 'stripe_invoice_items',
  refunds: 'stripe_refunds',
  products: 'stripe_products',
  prices: 'stripe_prices',
  coupons: 'stripe_coupons',
  disputes: 'stripe_disputes',
  paymentLinks: 'stripe_payment_links',
  events: 'stripe_events',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listWrap(data: unknown[], resource: string, hasMore = false) {
  return {
    object: 'list' as const,
    data,
    has_more: hasMore,
    url: `/v1/${resource}`,
  };
}

// ---------------------------------------------------------------------------
// Stripe Adapter
// ---------------------------------------------------------------------------

export class StripeAdapter extends BaseApiMockAdapter<StripeConfig> {
  readonly id = 'stripe';
  readonly name = 'Stripe API';
  readonly basePath = '/stripe/v1';
  readonly versions = [
    '2025-03-31.basil',
    '2025-09-30.clover',
    '2026-02-25.clover',
  ];

  readonly resourceSpecs: AdapterResourceSpecs = {
    platform: {
      timestampFormat: 'unix_seconds',
      amountFormat: 'integer_cents',
      idPrefix: 'cus_',
    },
    resources: {
      customers: {
        objectType: 'customer',
        volumeHint: 'entity',
        refs: [],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'cus_' },
          object: { type: 'string', required: true, default: 'customer' },
          email: { type: 'string', required: true, semanticType: 'email' },
          name: { type: 'string', required: true },
          currency: { type: 'string', required: true, semanticType: 'currency_code', default: 'usd' },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          description: { type: 'string', required: false, nullable: true },
          metadata: { type: 'object', required: false, default: {} },
          livemode: { type: 'boolean', required: false, default: false },
        },
      },
      products: {
        objectType: 'product',
        volumeHint: 'reference',
        refs: [],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'prod_' },
          object: { type: 'string', required: true, default: 'product' },
          name: { type: 'string', required: true },
          active: { type: 'boolean', required: true, default: true },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          description: { type: 'string', required: false, nullable: true },
          metadata: { type: 'object', required: false, default: {} },
        },
      },
      prices: {
        objectType: 'price',
        volumeHint: 'reference',
        refs: ['products'],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'price_' },
          object: { type: 'string', required: true, default: 'price' },
          product: { type: 'string', required: true, ref: 'products' },
          unit_amount: { type: 'integer', required: true, isAmount: true },
          currency: { type: 'string', required: true, semanticType: 'currency_code', default: 'usd' },
          type: { type: 'string', required: true, enum: ['one_time', 'recurring'], default: 'recurring' },
          recurring: { type: 'object', required: true, nullable: true },
          active: { type: 'boolean', required: true, default: true },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          metadata: { type: 'object', required: false, default: {} },
        },
      },
      subscriptions: {
        objectType: 'subscription',
        volumeHint: 'entity',
        refs: ['customers', 'prices'],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'sub_' },
          object: { type: 'string', required: true, default: 'subscription' },
          customer: { type: 'string', required: true, ref: 'customers' },
          status: {
            type: 'string', required: true,
            enum: ['active', 'past_due', 'canceled', 'trialing', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'],
          },
          currency: { type: 'string', required: true, semanticType: 'currency_code', default: 'usd' },
          items: { type: 'object', required: true },
          current_period_start: { type: 'integer', required: true, timestamp: 'unix_seconds' },
          current_period_end: { type: 'integer', required: true, timestamp: 'unix_seconds' },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          cancel_at: { type: 'integer', required: false, nullable: true, timestamp: 'unix_seconds' },
          canceled_at: { type: 'integer', required: false, nullable: true, timestamp: 'unix_seconds' },
          trial_start: { type: 'integer', required: false, nullable: true, timestamp: 'unix_seconds' },
          trial_end: { type: 'integer', required: false, nullable: true, timestamp: 'unix_seconds' },
          metadata: { type: 'object', required: false, default: {} },
          livemode: { type: 'boolean', required: false, default: false },
        },
      },
      invoices: {
        objectType: 'invoice',
        volumeHint: 'entity',
        refs: ['customers', 'subscriptions'],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'in_' },
          object: { type: 'string', required: true, default: 'invoice' },
          customer: { type: 'string', required: true, ref: 'customers' },
          subscription: { type: 'string', required: false, nullable: true, ref: 'subscriptions' },
          status: {
            type: 'string', required: true,
            enum: ['draft', 'open', 'paid', 'uncollectible', 'void'],
          },
          amount_due: { type: 'integer', required: true, isAmount: true },
          amount_paid: { type: 'integer', required: true, isAmount: true },
          amount_remaining: { type: 'integer', required: false, isAmount: true },
          currency: { type: 'string', required: true, semanticType: 'currency_code', default: 'usd' },
          total: { type: 'integer', required: false, isAmount: true },
          subtotal: { type: 'integer', required: false, isAmount: true },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          metadata: { type: 'object', required: false, default: {} },
          livemode: { type: 'boolean', required: false, default: false },
        },
      },
      payment_intents: {
        objectType: 'payment_intent',
        volumeHint: 'entity',
        refs: ['customers', 'invoices'],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'pi_' },
          object: { type: 'string', required: true, default: 'payment_intent' },
          customer: { type: 'string', required: true, ref: 'customers' },
          amount: { type: 'integer', required: true, isAmount: true },
          amount_captured: { type: 'integer', required: false, isAmount: true },
          amount_refunded: { type: 'integer', required: false, isAmount: true },
          currency: { type: 'string', required: true, semanticType: 'currency_code', default: 'usd' },
          status: {
            type: 'string', required: true,
            enum: ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded'],
          },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          metadata: { type: 'object', required: false, default: {} },
          livemode: { type: 'boolean', required: false, default: false },
        },
      },
      charges: {
        objectType: 'charge',
        volumeHint: 'entity',
        refs: ['customers', 'payment_intents'],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'ch_' },
          object: { type: 'string', required: true, default: 'charge' },
          customer: { type: 'string', required: true, ref: 'customers' },
          amount: { type: 'integer', required: true, isAmount: true },
          amount_captured: { type: 'integer', required: false, isAmount: true },
          amount_refunded: { type: 'integer', required: false, isAmount: true },
          currency: { type: 'string', required: true, semanticType: 'currency_code', default: 'usd' },
          status: {
            type: 'string', required: true,
            enum: ['succeeded', 'pending', 'failed'],
          },
          paid: { type: 'boolean', required: true },
          payment_intent: { type: 'string', required: false, nullable: true, ref: 'payment_intents' },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          metadata: { type: 'object', required: false, default: {} },
          livemode: { type: 'boolean', required: false, default: false },
        },
      },
      refunds: {
        objectType: 'refund',
        volumeHint: 'entity',
        refs: ['charges'],
        fields: {
          id: { type: 'string', required: true, idPrefix: 're_' },
          object: { type: 'string', required: true, default: 'refund' },
          charge: { type: 'string', required: true, ref: 'charges' },
          amount: { type: 'integer', required: true, isAmount: true },
          currency: { type: 'string', required: true, semanticType: 'currency_code', default: 'usd' },
          status: {
            type: 'string', required: true,
            enum: ['succeeded', 'pending', 'failed', 'canceled'],
          },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          metadata: { type: 'object', required: false, default: {} },
        },
      },
      coupons: {
        objectType: 'coupon',
        volumeHint: 'reference',
        refs: [],
        fields: {
          id: { type: 'string', required: true },
          object: { type: 'string', required: true, default: 'coupon' },
          percent_off: { type: 'number', required: false, nullable: true, semanticType: 'percentage' },
          amount_off: { type: 'integer', required: false, nullable: true, isAmount: true },
          currency: { type: 'string', required: false, nullable: true, semanticType: 'currency_code' },
          duration: { type: 'string', required: true, enum: ['once', 'repeating', 'forever'], default: 'once' },
          duration_in_months: { type: 'integer', required: false, nullable: true },
          max_redemptions: { type: 'integer', required: false, nullable: true },
          times_redeemed: { type: 'integer', required: false, default: 0 },
          valid: { type: 'boolean', required: false, default: true },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          metadata: { type: 'object', required: false, default: {} },
        },
      },
      disputes: {
        objectType: 'dispute',
        volumeHint: 'entity',
        refs: ['charges'],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'dp_' },
          object: { type: 'string', required: true, default: 'dispute' },
          charge: { type: 'string', required: true, ref: 'charges' },
          amount: { type: 'integer', required: true, isAmount: true },
          currency: { type: 'string', required: true, semanticType: 'currency_code', default: 'usd' },
          status: {
            type: 'string', required: true,
            enum: ['warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'charge_refunded', 'won', 'lost'],
          },
          reason: { type: 'string', required: false },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          metadata: { type: 'object', required: false, default: {} },
        },
      },
      payment_links: {
        objectType: 'payment_link',
        volumeHint: 'reference',
        refs: [],
        fields: {
          id: { type: 'string', required: true, idPrefix: 'plink_' },
          object: { type: 'string', required: true, default: 'payment_link' },
          active: { type: 'boolean', required: true, default: true },
          url: { type: 'string', required: true, semanticType: 'url' },
          created: { type: 'integer', required: true, timestamp: 'unix_seconds', auto: true },
          metadata: { type: 'object', required: false, default: {} },
          livemode: { type: 'boolean', required: false, default: false },
        },
      },
    },
  };

  readonly promptContext = derivePromptContext(this.resourceSpecs);
  readonly dataSpec: DataSpec = deriveDataSpec(this.resourceSpecs);

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerStripeTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+sk_test_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    // ── Customers ──────────────────────────────────────────────────────────

    server.post('/stripe/v1/customers', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const customer = {
        id: generateId('cus', 14),
        object: 'customer',
        created: now,
        email: body.email ?? null,
        name: body.name ?? null,
        description: body.description ?? null,
        metadata: body.metadata ?? {},
        livemode: false,
        ...body,
      };
      store.set(NS.customers, customer.id, customer);
      return reply.code(200).send(customer);
    });

    server.get('/stripe/v1/customers', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let customers = store.list<Record<string, unknown>>(NS.customers);

      if (query.email) {
        customers = customers.filter((c) => c.email === query.email);
      }

      // Cursor-based pagination via starting_after + limit
      const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 10;
      let startIdx = 0;

      if (query.starting_after) {
        const idx = customers.findIndex((c) => c.id === query.starting_after);
        if (idx >= 0) startIdx = idx + 1;
      }

      const page = customers.slice(startIdx, startIdx + limit);
      const hasMore = startIdx + limit < customers.length;

      return reply.code(200).send(listWrap(page, 'customers', hasMore));
    });

    server.get('/stripe/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get(NS.customers, id);
      if (!customer) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such customer: '${id}'`));
      }
      return reply.code(200).send(customer);
    });

    server.post('/stripe/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.customers, id);
      if (!existing) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such customer: '${id}'`));
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body };
      store.set(NS.customers, id, updated);
      return reply.code(200).send(updated);
    });

    server.delete('/stripe/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      store.delete(NS.customers, id);
      return reply.code(200).send({ id, object: 'customer', deleted: true });
    });

    // ── Payment Intents ────────────────────────────────────────────────────

    server.post('/stripe/v1/payment_intents', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const id = generateId('pi', 24);
      const pi = {
        ...body,
        id,
        object: 'payment_intent',
        amount: body.amount ?? 0,
        currency: body.currency ?? 'usd',
        capture_method: body.capture_method ?? 'automatic',
        client_secret: `${id}_secret_${generateId('', 12).slice(1)}`,
        created: now,
        metadata: body.metadata ?? {},
        latest_charge: null,
        livemode: false,
        status: 'requires_payment_method',
      };
      store.set(NS.pis, pi.id, pi);
      return reply.code(200).send(pi);
    });

    server.get('/stripe/v1/payment_intents', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let pis = store.list<Record<string, unknown>>(NS.pis);

      if (query.customer) {
        pis = pis.filter((p) => p.customer === query.customer);
      }

      const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 10;
      const page = pis.slice(0, limit);
      const hasMore = limit < pis.length;

      return reply.code(200).send(listWrap(page, 'payment_intents', hasMore));
    });

    server.get('/stripe/v1/payment_intents/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const pi = store.get(NS.pis, id);
      if (!pi) {
        return reply
          .code(404)
          .send(
            stripeError('resource_missing', `No such payment_intent: '${id}'`),
          );
      }
      return reply.code(200).send(pi);
    });

    server.post(
      '/stripe/v1/payment_intents/:id/confirm',
      async (req, reply) => {
        const { id } = req.params as { id: string };
        const pi = store.get<Record<string, unknown>>(NS.pis, id);
        if (!pi) {
          return reply
            .code(404)
            .send(
              stripeError(
                'resource_missing',
                `No such payment_intent: '${id}'`,
              ),
            );
        }

        const body = (req.body ?? {}) as Record<string, unknown>;

        // Create a charge
        const chargeId = generateId('ch', 24);
        const now = unixNow();
        const charge = {
          id: chargeId,
          object: 'charge',
          amount: pi.amount,
          currency: pi.currency,
          status: 'succeeded',
          payment_intent: id,
          created: now,
          livemode: false,
        };
        store.set(NS.charges, chargeId, charge);

        // Determine capture method — check body first, then existing PI
        const captureMethod =
          body.capture_method ?? pi.capture_method ?? 'automatic';

        const newStatus =
          captureMethod === 'manual' ? 'requires_capture' : 'succeeded';

        const updated = {
          ...pi,
          ...body,
          status: newStatus,
          latest_charge: chargeId,
          capture_method: captureMethod,
        };
        store.set(NS.pis, id, updated);
        return reply.code(200).send(updated);
      },
    );

    server.post(
      '/stripe/v1/payment_intents/:id/capture',
      async (req, reply) => {
        const { id } = req.params as { id: string };
        const pi = store.get<Record<string, unknown>>(NS.pis, id);
        if (!pi) {
          return reply
            .code(404)
            .send(
              stripeError(
                'resource_missing',
                `No such payment_intent: '${id}'`,
              ),
            );
        }

        if (pi.status !== 'requires_capture') {
          return reply
            .code(400)
            .send(
              stripeError(
                'payment_intent_unexpected_state',
                `This PaymentIntent's status is ${pi.status}, but must be requires_capture to capture.`,
              ),
            );
        }

        const body = (req.body ?? {}) as Record<string, unknown>;

        // Support partial capture via amount_to_capture
        const capturedAmount =
          body.amount_to_capture != null
            ? Number(body.amount_to_capture)
            : pi.amount;

        const updated = {
          ...pi,
          status: 'succeeded',
          amount_captured: capturedAmount,
        };
        store.set(NS.pis, id, updated);
        return reply.code(200).send(updated);
      },
    );

    server.post(
      '/stripe/v1/payment_intents/:id/cancel',
      async (req, reply) => {
        const { id } = req.params as { id: string };
        const pi = store.get<Record<string, unknown>>(NS.pis, id);
        if (!pi) {
          return reply
            .code(404)
            .send(
              stripeError(
                'resource_missing',
                `No such payment_intent: '${id}'`,
              ),
            );
        }
        const updated = { ...pi, status: 'canceled' };
        store.set(NS.pis, id, updated);
        return reply.code(200).send(updated);
      },
    );

    // ── Charges ────────────────────────────────────────────────────────────

    server.get('/stripe/v1/charges', async (_req, reply) => {
      const charges = store.list(NS.charges);
      return reply.code(200).send(listWrap(charges, 'charges'));
    });

    server.get('/stripe/v1/charges/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const charge = store.get(NS.charges, id);
      if (!charge) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such charge: '${id}'`));
      }
      return reply.code(200).send(charge);
    });

    // ── Subscriptions ──────────────────────────────────────────────────────

    server.post('/stripe/v1/subscriptions', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const id = generateId('sub', 14);

      // Build subscription items from the items array if provided
      const rawItems = (body.items ?? []) as Record<string, unknown>[];
      const subItems = rawItems.map((item) => ({
        id: generateId('si', 14),
        object: 'subscription_item',
        ...item,
      }));

      const sub = {
        ...body,
        id,
        object: 'subscription',
        customer: body.customer ?? null,
        items: {
          object: 'list',
          data: subItems,
        },
        current_period_start: now,
        current_period_end: now + 30 * 86400,
        created: now,
        metadata: body.metadata ?? {},
        livemode: false,
        status: 'active',
      };
      store.set(NS.subs, sub.id, sub);
      return reply.code(200).send(sub);
    });

    server.get('/stripe/v1/subscriptions', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let subs = store.list<Record<string, unknown>>(NS.subs);

      if (query.customer) {
        subs = subs.filter((s) => s.customer === query.customer);
      }
      if (query.status) {
        subs = subs.filter((s) => s.status === query.status);
      }

      return reply.code(200).send(listWrap(subs, 'subscriptions'));
    });

    server.get('/stripe/v1/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subs, id);
      if (!sub) {
        return reply
          .code(404)
          .send(
            stripeError('resource_missing', `No such subscription: '${id}'`),
          );
      }
      return reply.code(200).send(sub);
    });

    server.post('/stripe/v1/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subs, id);
      if (!existing) {
        return reply
          .code(404)
          .send(
            stripeError('resource_missing', `No such subscription: '${id}'`),
          );
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body };
      store.set(NS.subs, id, updated);
      return reply.code(200).send(updated);
    });

    server.delete('/stripe/v1/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subs, id);
      if (!existing) {
        return reply
          .code(404)
          .send(
            stripeError('resource_missing', `No such subscription: '${id}'`),
          );
      }
      const canceled = { ...existing, status: 'canceled' };
      store.set(NS.subs, id, canceled);
      return reply.code(200).send(canceled);
    });

    // ── Invoices ───────────────────────────────────────────────────────────

    server.post('/stripe/v1/invoices', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const id = generateId('in', 14);
      const invoice = {
        ...body,
        id,
        object: 'invoice',
        customer: body.customer ?? null,
        amount_due: body.amount_due ?? 0,
        currency: body.currency ?? 'usd',
        created: now,
        metadata: body.metadata ?? {},
        livemode: false,
        status: 'draft',
      };
      store.set(NS.invoices, invoice.id, invoice);
      return reply.code(200).send(invoice);
    });

    server.get('/stripe/v1/invoices', async (_req, reply) => {
      const invoices = store.list(NS.invoices);
      return reply.code(200).send(listWrap(invoices, 'invoices'));
    });

    server.get('/stripe/v1/invoices/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get(NS.invoices, id);
      if (!invoice) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such invoice: '${id}'`));
      }
      return reply.code(200).send(invoice);
    });

    server.post('/stripe/v1/invoices/:id/pay', async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get<Record<string, unknown>>(NS.invoices, id);
      if (!invoice) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such invoice: '${id}'`));
      }
      const paid = { ...invoice, status: 'paid' };
      store.set(NS.invoices, id, paid);
      return reply.code(200).send(paid);
    });

    // ── Refunds ────────────────────────────────────────────────────────────

    server.post('/stripe/v1/refunds', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const refund = {
        ...body,
        id: generateId('re', 24),
        object: 'refund',
        amount: body.amount ?? 0,
        charge: body.charge ?? null,
        payment_intent: body.payment_intent ?? null,
        currency: body.currency ?? 'usd',
        created: now,
        metadata: body.metadata ?? {},
        status: 'succeeded',
      };
      store.set(NS.refunds, refund.id, refund);
      return reply.code(200).send(refund);
    });

    server.get('/stripe/v1/refunds', async (_req, reply) => {
      const refunds = store.list(NS.refunds);
      return reply.code(200).send(listWrap(refunds, 'refunds'));
    });

    // ── Products ───────────────────────────────────────────────────────────

    server.post('/stripe/v1/products', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const product = {
        id: generateId('prod', 14),
        object: 'product',
        name: body.name ?? '',
        active: true,
        created: now,
        metadata: body.metadata ?? {},
        livemode: false,
        ...body,
      };
      store.set(NS.products, product.id, product);
      return reply.code(200).send(product);
    });

    server.get('/stripe/v1/products', async (_req, reply) => {
      const products = store.list(NS.products);
      return reply.code(200).send(listWrap(products, 'products'));
    });

    // ── Prices ─────────────────────────────────────────────────────────────

    server.post('/stripe/v1/prices', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const price = {
        id: generateId('price', 14),
        object: 'price',
        active: true,
        currency: body.currency ?? 'usd',
        unit_amount: body.unit_amount ?? 0,
        product: body.product ?? null,
        type: body.type ?? 'one_time',
        created: now,
        metadata: body.metadata ?? {},
        livemode: false,
        ...body,
      };
      store.set(NS.prices, price.id, price);
      return reply.code(200).send(price);
    });

    server.get('/stripe/v1/prices', async (_req, reply) => {
      const prices = store.list(NS.prices);
      return reply.code(200).send(listWrap(prices, 'prices'));
    });

    // ── Coupons ──────────────────────────────────────────────────────────

    server.post('/stripe/v1/coupons', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const coupon = {
        id: (body.id as string) || generateId('', 8).slice(1),
        object: 'coupon',
        percent_off: body.percent_off != null ? Number(body.percent_off) : null,
        amount_off: body.amount_off != null ? Number(body.amount_off) : null,
        currency: body.currency ?? (body.amount_off != null ? 'usd' : null),
        duration: body.duration ?? 'once',
        duration_in_months: body.duration_in_months ?? null,
        max_redemptions: body.max_redemptions ?? null,
        times_redeemed: 0,
        valid: true,
        created: now,
        livemode: false,
        metadata: body.metadata ?? {},
      };
      store.set(NS.coupons, coupon.id, coupon);
      return reply.code(200).send(coupon);
    });

    server.get('/stripe/v1/coupons', async (_req, reply) => {
      const coupons = store.list(NS.coupons);
      return reply.code(200).send(listWrap(coupons, 'coupons'));
    });

    server.get('/stripe/v1/coupons/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const coupon = store.get(NS.coupons, id);
      if (!coupon) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such coupon: '${id}'`));
      }
      return reply.code(200).send(coupon);
    });

    server.delete('/stripe/v1/coupons/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      store.delete(NS.coupons, id);
      return reply.code(200).send({ id, object: 'coupon', deleted: true });
    });

    // ── Disputes ────────────────────────────────────────────────────────

    server.get('/stripe/v1/disputes', async (_req, reply) => {
      const disputes = store.list(NS.disputes);
      return reply.code(200).send(listWrap(disputes, 'disputes'));
    });

    server.get('/stripe/v1/disputes/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get(NS.disputes, id);
      if (!dispute) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such dispute: '${id}'`));
      }
      return reply.code(200).send(dispute);
    });

    server.post('/stripe/v1/disputes/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.disputes, id);
      if (!existing) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such dispute: '${id}'`));
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body };
      store.set(NS.disputes, id, updated);
      return reply.code(200).send(updated);
    });

    server.post('/stripe/v1/disputes/:id/close', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.disputes, id);
      if (!existing) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such dispute: '${id}'`));
      }
      const updated = { ...existing, status: 'lost' };
      store.set(NS.disputes, id, updated);
      return reply.code(200).send(updated);
    });

    // ── Invoice Items ───────────────────────────────────────────────────

    server.post('/stripe/v1/invoiceitems', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const item = {
        id: generateId('ii', 24),
        object: 'invoiceitem',
        customer: body.customer ?? null,
        amount: body.amount != null ? Number(body.amount) : 0,
        currency: body.currency ?? 'usd',
        description: body.description ?? null,
        invoice: body.invoice ?? null,
        price: body.price ?? null,
        quantity: body.quantity ?? 1,
        created: now,
        livemode: false,
        metadata: body.metadata ?? {},
      };
      store.set(NS.invoiceItems, item.id, item);
      return reply.code(200).send(item);
    });

    // ── Invoice Finalize ────────────────────────────────────────────────

    server.post('/stripe/v1/invoices/:id/finalize', async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get<Record<string, unknown>>(NS.invoices, id);
      if (!invoice) {
        return reply
          .code(404)
          .send(stripeError('resource_missing', `No such invoice: '${id}'`));
      }
      const finalized = { ...invoice, status: 'open' };
      store.set(NS.invoices, id, finalized);
      return reply.code(200).send(finalized);
    });

    // ── Payment Links ───────────────────────────────────────────────────

    server.post('/stripe/v1/payment_links', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const link = {
        id: generateId('plink', 14),
        object: 'payment_link',
        active: true,
        url: `https://buy.stripe.com/${generateId('', 12).slice(1)}`,
        line_items: body.line_items ?? null,
        metadata: body.metadata ?? {},
        created: now,
        livemode: false,
      };
      store.set(NS.paymentLinks, link.id, link);
      return reply.code(200).send(link);
    });

    server.get('/stripe/v1/payment_links', async (_req, reply) => {
      const links = store.list(NS.paymentLinks);
      return reply.code(200).send(listWrap(links, 'payment_links'));
    });

    // ── Billing Portal ──────────────────────────────────────────────────

    server.post('/stripe/v1/billing_portal/sessions', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const session = {
        id: generateId('bps', 24),
        object: 'billing_portal.session',
        customer: body.customer ?? null,
        url: `https://billing.stripe.com/session/${generateId('', 20).slice(1)}`,
        return_url: body.return_url ?? null,
        created: now,
        livemode: false,
      };
      return reply.code(200).send(session);
    });

    // ── Account ─────────────────────────────────────────────────────────

    server.get('/stripe/v1/account', async (_req, reply) => {
      return reply.code(200).send({
        id: 'acct_1234567890',
        object: 'account',
        business_type: 'company',
        country: 'US',
        email: 'test@example.com',
        charges_enabled: true,
        payouts_enabled: true,
        capabilities: { card_payments: 'active', transfers: 'active' },
        created: unixNow(),
        livemode: false,
      });
    });

    // ── Balance ────────────────────────────────────────────────────────────

    server.get('/stripe/v1/balance', async (_req, reply) => {
      return reply.code(200).send({
        object: 'balance',
        available: [{ amount: 125000, currency: 'usd', source_types: { card: 125000 } }],
        pending: [{ amount: 35000, currency: 'usd', source_types: { card: 35000 } }],
        livemode: false,
      });
    });

    // ── Events ─────────────────────────────────────────────────────────────

    server.get('/stripe/v1/events', async (_req, reply) => {
      const events = store.list(NS.events);
      return reply.code(200).send(listWrap(events, 'events'));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Customers
      { method: 'GET', path: '/stripe/v1/customers', description: 'List customers' },
      { method: 'GET', path: '/stripe/v1/customers/:id', description: 'Get customer' },
      { method: 'POST', path: '/stripe/v1/customers', description: 'Create customer' },
      { method: 'POST', path: '/stripe/v1/customers/:id', description: 'Update customer' },
      { method: 'DELETE', path: '/stripe/v1/customers/:id', description: 'Delete customer' },

      // Payment Intents
      { method: 'POST', path: '/stripe/v1/payment_intents', description: 'Create payment intent' },
      { method: 'GET', path: '/stripe/v1/payment_intents', description: 'List payment intents' },
      { method: 'GET', path: '/stripe/v1/payment_intents/:id', description: 'Get payment intent' },
      { method: 'POST', path: '/stripe/v1/payment_intents/:id/confirm', description: 'Confirm payment intent' },
      { method: 'POST', path: '/stripe/v1/payment_intents/:id/capture', description: 'Capture payment intent' },
      { method: 'POST', path: '/stripe/v1/payment_intents/:id/cancel', description: 'Cancel payment intent' },

      // Charges
      { method: 'GET', path: '/stripe/v1/charges', description: 'List charges' },
      { method: 'GET', path: '/stripe/v1/charges/:id', description: 'Get charge' },

      // Subscriptions
      { method: 'POST', path: '/stripe/v1/subscriptions', description: 'Create subscription' },
      { method: 'GET', path: '/stripe/v1/subscriptions', description: 'List subscriptions' },
      { method: 'GET', path: '/stripe/v1/subscriptions/:id', description: 'Get subscription' },
      { method: 'POST', path: '/stripe/v1/subscriptions/:id', description: 'Update subscription' },
      { method: 'DELETE', path: '/stripe/v1/subscriptions/:id', description: 'Cancel subscription' },

      // Invoices
      { method: 'POST', path: '/stripe/v1/invoices', description: 'Create invoice' },
      { method: 'GET', path: '/stripe/v1/invoices', description: 'List invoices' },
      { method: 'GET', path: '/stripe/v1/invoices/:id', description: 'Get invoice' },
      { method: 'POST', path: '/stripe/v1/invoices/:id/finalize', description: 'Finalize invoice' },
      { method: 'POST', path: '/stripe/v1/invoices/:id/pay', description: 'Pay invoice' },

      // Invoice Items
      { method: 'POST', path: '/stripe/v1/invoiceitems', description: 'Create invoice item' },

      // Refunds
      { method: 'POST', path: '/stripe/v1/refunds', description: 'Create refund' },
      { method: 'GET', path: '/stripe/v1/refunds', description: 'List refunds' },

      // Products
      { method: 'POST', path: '/stripe/v1/products', description: 'Create product' },
      { method: 'GET', path: '/stripe/v1/products', description: 'List products' },

      // Prices
      { method: 'POST', path: '/stripe/v1/prices', description: 'Create price' },
      { method: 'GET', path: '/stripe/v1/prices', description: 'List prices' },

      // Coupons
      { method: 'POST', path: '/stripe/v1/coupons', description: 'Create coupon' },
      { method: 'GET', path: '/stripe/v1/coupons', description: 'List coupons' },
      { method: 'GET', path: '/stripe/v1/coupons/:id', description: 'Get coupon' },
      { method: 'DELETE', path: '/stripe/v1/coupons/:id', description: 'Delete coupon' },

      // Disputes
      { method: 'GET', path: '/stripe/v1/disputes', description: 'List disputes' },
      { method: 'GET', path: '/stripe/v1/disputes/:id', description: 'Get dispute' },
      { method: 'POST', path: '/stripe/v1/disputes/:id', description: 'Update dispute' },
      { method: 'POST', path: '/stripe/v1/disputes/:id/close', description: 'Close dispute' },

      // Payment Links
      { method: 'POST', path: '/stripe/v1/payment_links', description: 'Create payment link' },
      { method: 'GET', path: '/stripe/v1/payment_links', description: 'List payment links' },

      // Billing Portal
      { method: 'POST', path: '/stripe/v1/billing_portal/sessions', description: 'Create billing portal session' },

      // Account
      { method: 'GET', path: '/stripe/v1/account', description: 'Get account info' },

      // Balance
      { method: 'GET', path: '/stripe/v1/balance', description: 'Get balance' },

      // Events
      { method: 'GET', path: '/stripe/v1/events', description: 'List events' },
    ];
  }

  // ── Cross-surface seeding ────────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    customers: NS.customers,
    payment_intents: NS.pis,
    charges: NS.charges,
    subscriptions: NS.subs,
    invoices: NS.invoices,
    invoice_items: NS.invoiceItems,
    refunds: NS.refunds,
    products: NS.products,
    prices: NS.prices,
    coupons: NS.coupons,
    disputes: NS.disputes,
    payment_links: NS.paymentLinks,
  };

  private readonly RESOURCE_OBJECT: Record<string, string> = {
    customers: 'customer',
    payment_intents: 'payment_intent',
    charges: 'charge',
    subscriptions: 'subscription',
    invoices: 'invoice',
    invoice_items: 'invoiceitem',
    refunds: 'refund',
    products: 'product',
    prices: 'price',
    coupons: 'coupon',
    disputes: 'dispute',
    payment_links: 'payment_link',
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const stripeData = expanded.apiResponses?.stripe;
      if (!stripeData) continue;

      for (const [resourceType, responses] of Object.entries(
        stripeData.responses,
      )) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          if (!body.id) continue;

          const enriched = {
            object: this.RESOURCE_OBJECT[resourceType] ?? resourceType,
            livemode: false,
            created: body.created ?? unixNow(),
            metadata: body.metadata ?? {},
            ...body,
          };

          store.set(namespace, String(body.id), enriched);
        }
      }
    }
  }
}
