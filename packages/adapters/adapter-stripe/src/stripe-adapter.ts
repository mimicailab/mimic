import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EndpointDefinition, ExpandedData } from '@mimicailab/core';
import type { StateStore } from '@mimicailab/core';
import { BaseApiMockAdapter, generateId, unixNow } from '@mimicailab/adapter-sdk';
import type { StripeConfig } from './config.js';
import { stripeError } from './stripe-errors.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  customers: 'stripe_customers',
  pis: 'stripe_pis',
  charges: 'stripe_charges',
  subs: 'stripe_subs',
  invoices: 'stripe_invoices',
  refunds: 'stripe_refunds',
  products: 'stripe_products',
  prices: 'stripe_prices',
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
      { method: 'POST', path: '/stripe/v1/invoices/:id/pay', description: 'Pay invoice' },

      // Refunds
      { method: 'POST', path: '/stripe/v1/refunds', description: 'Create refund' },
      { method: 'GET', path: '/stripe/v1/refunds', description: 'List refunds' },

      // Products
      { method: 'POST', path: '/stripe/v1/products', description: 'Create product' },
      { method: 'GET', path: '/stripe/v1/products', description: 'List products' },

      // Prices
      { method: 'POST', path: '/stripe/v1/prices', description: 'Create price' },
      { method: 'GET', path: '/stripe/v1/prices', description: 'List prices' },

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
    refunds: NS.refunds,
    products: NS.products,
    prices: NS.prices,
  };

  private readonly RESOURCE_OBJECT: Record<string, string> = {
    customers: 'customer',
    payment_intents: 'payment_intent',
    charges: 'charge',
    subscriptions: 'subscription',
    invoices: 'invoice',
    refunds: 'refund',
    products: 'product',
    prices: 'price',
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
