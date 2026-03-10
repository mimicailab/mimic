import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId, unixNow } from '@mimicai/adapter-sdk';
import type { PaddleConfig } from './config.js';
import { notFound } from './paddle-errors.js';
import { registerPaddleTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  products: 'paddle_products',
  prices: 'paddle_prices',
  customers: 'paddle_customers',
  addresses: 'paddle_addresses',
  businesses: 'paddle_businesses',
  subscriptions: 'paddle_subscriptions',
  transactions: 'paddle_transactions',
  adjustments: 'paddle_adjustments',
  discounts: 'paddle_discounts',
  discountGroups: 'paddle_discount_groups',
  paymentMethods: 'paddle_payment_methods',
  notifications: 'paddle_notifications',
  notificationSettings: 'paddle_notification_settings',
  events: 'paddle_events',
  simulations: 'paddle_simulations',
  simulationRuns: 'paddle_simulation_runs',
  simulationRunEvents: 'paddle_simulation_run_events',
  reports: 'paddle_reports',
  clientSideTokens: 'paddle_client_side_tokens',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function paddleId(prefix: string): string {
  return generateId(`${prefix}_`, 14);
}

function isoNow(): string {
  return new Date().toISOString();
}

function wrapResponse(data: unknown, pagination?: { next?: string; has_more: boolean; estimated_total: number }) {
  return {
    data,
    meta: pagination
      ? { request_id: `req_${Date.now()}`, pagination }
      : { request_id: `req_${Date.now()}` },
  };
}

function wrapList(items: unknown[], hasMore = false) {
  return wrapResponse(items, {
    has_more: hasMore,
    estimated_total: items.length,
  });
}

// ---------------------------------------------------------------------------
// Paddle Adapter
// ---------------------------------------------------------------------------

export class PaddleAdapter extends BaseApiMockAdapter<PaddleConfig> {
  readonly id = 'paddle';
  readonly name = 'Paddle API';
  readonly basePath = '/paddle';
  readonly versions = ['1'];

  readonly promptContext = {
    resources: ['customers', 'products', 'prices', 'subscriptions', 'transactions', 'adjustments', 'discounts'],
    amountFormat: 'decimal string (e.g. "29.99")',
    relationships: [
      'subscription → customer, price',
      'transaction → customer, subscription',
      'adjustment → transaction',
      'price → product',
    ],
    requiredFields: {
      customers: ['id', 'email', 'name', 'status', 'created_at'],
      products: ['id', 'name', 'status', 'tax_category', 'created_at'],
      prices: ['id', 'product_id', 'unit_price', 'status', 'billing_cycle', 'created_at'],
      subscriptions: ['id', 'customer_id', 'status', 'currency_code', 'created_at'],
      transactions: ['id', 'customer_id', 'status', 'currency_code', 'created_at'],
    },
    notes: 'Paddle is a merchant of record. Amounts are decimal strings NOT cents. Timestamps are ISO 8601 strings (not Unix). IDs prefixed: ctm_, pro_, pri_, sub_, txn_. Subscription status: active, canceled, past_due, paused, trialing.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    idPrefixes: { customers: 'ctm_', products: 'pro_', prices: 'pri_', subscriptions: 'sub_', transactions: 'txn_' },
    amountFields: ['unit_price', 'total'],
    statusEnums: {
      subscriptions: ['active', 'canceled', 'past_due', 'paused', 'trialing'],
      transactions: ['draft', 'ready', 'billed', 'paid', 'completed', 'canceled', 'past_due'],
    },
    timestampFields: ['created_at', 'updated_at', 'billed_at', 'started_at', 'first_billed_at'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerPaddleTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+pdl_test_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    // ── Products ────────────────────────────────────────────────────────

    server.post('/paddle/products', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const product = {
        id: paddleId('pro'),
        status: 'active',
        name: body.name ?? '',
        description: body.description ?? null,
        type: body.type ?? 'standard',
        tax_category: body.tax_category ?? 'standard',
        image_url: body.image_url ?? null,
        custom_data: body.custom_data ?? null,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.products, product.id, product);
      return reply.code(201).send(wrapResponse(product));
    });

    server.get('/paddle/products', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let products = store.list<Record<string, unknown>>(NS.products);
      if (query.status) products = products.filter((p) => p.status === query.status);
      return reply.code(200).send(wrapList(products));
    });

    server.get('/paddle/products/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const product = store.get(NS.products, id);
      if (!product) return reply.code(404).send(notFound('Product', id));
      return reply.code(200).send(wrapResponse(product));
    });

    server.patch('/paddle/products/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.products, id);
      if (!existing) return reply.code(404).send(notFound('Product', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.products, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    // ── Prices ──────────────────────────────────────────────────────────

    server.post('/paddle/prices', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const price = {
        id: paddleId('pri'),
        product_id: body.product_id ?? null,
        status: 'active',
        description: body.description ?? '',
        type: body.type ?? 'standard',
        billing_cycle: body.billing_cycle ?? null,
        trial_period: body.trial_period ?? null,
        tax_mode: body.tax_mode ?? 'account_setting',
        unit_price: body.unit_price ?? { amount: '0', currency_code: 'USD' },
        custom_data: body.custom_data ?? null,
        quantity: body.quantity ?? { minimum: 1, maximum: 100 },
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.prices, price.id, price);
      return reply.code(201).send(wrapResponse(price));
    });

    server.get('/paddle/prices', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let prices = store.list<Record<string, unknown>>(NS.prices);
      if (query.product_id) prices = prices.filter((p) => p.product_id === query.product_id);
      if (query.status) prices = prices.filter((p) => p.status === query.status);
      return reply.code(200).send(wrapList(prices));
    });

    server.get('/paddle/prices/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const price = store.get(NS.prices, id);
      if (!price) return reply.code(404).send(notFound('Price', id));
      return reply.code(200).send(wrapResponse(price));
    });

    server.patch('/paddle/prices/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.prices, id);
      if (!existing) return reply.code(404).send(notFound('Price', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.prices, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    // ── Pricing Preview ─────────────────────────────────────────────────

    server.post('/paddle/pricing-preview', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const items = (body.items ?? []) as Record<string, unknown>[];
      const previewItems = items.map((item) => ({
        price: item.price ?? store.get(NS.prices, item.price_id as string) ?? {},
        quantity: item.quantity ?? 1,
        tax_rate: '0.20',
        unit_totals: { subtotal: '1000', discount: '0', tax: '200', total: '1200' },
        totals: { subtotal: '1000', discount: '0', tax: '200', total: '1200' },
      }));
      return reply.code(200).send(wrapResponse({
        customer_id: body.customer_id ?? null,
        address_id: body.address_id ?? null,
        currency_code: body.currency_code ?? 'USD',
        discount_id: body.discount_id ?? null,
        items: previewItems,
      }));
    });

    // ── Customers ───────────────────────────────────────────────────────

    server.post('/paddle/customers', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const customer = {
        id: paddleId('ctm'),
        status: 'active',
        name: body.name ?? null,
        email: body.email ?? null,
        locale: body.locale ?? 'en',
        custom_data: body.custom_data ?? null,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.customers, customer.id, customer);
      return reply.code(201).send(wrapResponse(customer));
    });

    server.get('/paddle/customers', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let customers = store.list<Record<string, unknown>>(NS.customers);
      if (query.email) customers = customers.filter((c) => c.email === query.email);
      if (query.status) customers = customers.filter((c) => c.status === query.status);
      return reply.code(200).send(wrapList(customers));
    });

    server.get('/paddle/customers/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get(NS.customers, id);
      if (!customer) return reply.code(404).send(notFound('Customer', id));
      return reply.code(200).send(wrapResponse(customer));
    });

    server.patch('/paddle/customers/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.customers, id);
      if (!existing) return reply.code(404).send(notFound('Customer', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.customers, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.get('/paddle/customers/:id/credit-balances', async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get(NS.customers, id);
      if (!customer) return reply.code(404).send(notFound('Customer', id));
      return reply.code(200).send(wrapList([
        { currency_code: 'USD', balance: { available: '0', reserved: '0', used: '0' } },
      ]));
    });

    // ── Addresses ───────────────────────────────────────────────────────

    server.post('/paddle/customers/:customerId/addresses', async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const address = {
        id: paddleId('add'),
        customer_id: customerId,
        status: 'active',
        description: body.description ?? null,
        first_line: body.first_line ?? null,
        second_line: body.second_line ?? null,
        city: body.city ?? null,
        postal_code: body.postal_code ?? null,
        region: body.region ?? null,
        country_code: body.country_code ?? 'US',
        custom_data: body.custom_data ?? null,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.addresses, address.id, address);
      return reply.code(201).send(wrapResponse(address));
    });

    server.get('/paddle/customers/:customerId/addresses', async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const addresses = store.filter<Record<string, unknown>>(
        NS.addresses,
        (a) => a.customer_id === customerId,
      );
      return reply.code(200).send(wrapList(addresses));
    });

    server.get('/paddle/customers/:customerId/addresses/:id', async (req, reply) => {
      const { id } = req.params as { customerId: string; id: string };
      const address = store.get(NS.addresses, id);
      if (!address) return reply.code(404).send(notFound('Address', id));
      return reply.code(200).send(wrapResponse(address));
    });

    server.patch('/paddle/customers/:customerId/addresses/:id', async (req, reply) => {
      const { id } = req.params as { customerId: string; id: string };
      const existing = store.get<Record<string, unknown>>(NS.addresses, id);
      if (!existing) return reply.code(404).send(notFound('Address', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.addresses, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    // ── Businesses ──────────────────────────────────────────────────────

    server.post('/paddle/customers/:customerId/businesses', async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const business = {
        id: paddleId('biz'),
        customer_id: customerId,
        status: 'active',
        name: body.name ?? '',
        company_number: body.company_number ?? null,
        tax_identifier: body.tax_identifier ?? null,
        contacts: body.contacts ?? [],
        custom_data: body.custom_data ?? null,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.businesses, business.id, business);
      return reply.code(201).send(wrapResponse(business));
    });

    server.get('/paddle/customers/:customerId/businesses', async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const businesses = store.filter<Record<string, unknown>>(
        NS.businesses,
        (b) => b.customer_id === customerId,
      );
      return reply.code(200).send(wrapList(businesses));
    });

    server.get('/paddle/customers/:customerId/businesses/:id', async (req, reply) => {
      const { id } = req.params as { customerId: string; id: string };
      const business = store.get(NS.businesses, id);
      if (!business) return reply.code(404).send(notFound('Business', id));
      return reply.code(200).send(wrapResponse(business));
    });

    server.patch('/paddle/customers/:customerId/businesses/:id', async (req, reply) => {
      const { id } = req.params as { customerId: string; id: string };
      const existing = store.get<Record<string, unknown>>(NS.businesses, id);
      if (!existing) return reply.code(404).send(notFound('Business', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.businesses, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    // ── Subscriptions ───────────────────────────────────────────────────

    server.get('/paddle/subscriptions', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let subs = store.list<Record<string, unknown>>(NS.subscriptions);
      if (query.customer_id) subs = subs.filter((s) => s.customer_id === query.customer_id);
      if (query.status) subs = subs.filter((s) => s.status === query.status);
      return reply.code(200).send(wrapList(subs));
    });

    server.get('/paddle/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.code(404).send(notFound('Subscription', id));
      return reply.code(200).send(wrapResponse(sub));
    });

    server.patch('/paddle/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.post('/paddle/subscriptions/:id/pause', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, status: 'paused', paused_at: isoNow(), updated_at: isoNow() };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.post('/paddle/subscriptions/:id/resume', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, status: 'active', paused_at: null, updated_at: isoNow() };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.post('/paddle/subscriptions/:id/cancel', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const effectiveFrom = body.effective_from ?? 'next_billing_period';
      const status = effectiveFrom === 'immediately' ? 'canceled' : 'active';
      const billingPeriod = existing.current_billing_period as Record<string, unknown> | undefined;
      const updated = {
        ...existing,
        status,
        scheduled_change: effectiveFrom !== 'immediately'
          ? { action: 'cancel', effective_at: billingPeriod?.ends_at ?? isoNow() }
          : null,
        canceled_at: effectiveFrom === 'immediately' ? isoNow() : null,
        updated_at: isoNow(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.post('/paddle/subscriptions/:id/activate', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = { ...existing, status: 'active', updated_at: isoNow() };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.get('/paddle/subscriptions/:id/update-payment-method-transaction', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!sub) return reply.code(404).send(notFound('Subscription', id));
      const txn = {
        id: paddleId('txn'),
        status: 'ready',
        subscription_id: id,
        created_at: isoNow(),
        updated_at: isoNow(),
      };
      return reply.code(200).send(wrapResponse(txn));
    });

    server.post('/paddle/subscriptions/:id/charge', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const txn = {
        id: paddleId('txn'),
        subscription_id: id,
        status: 'completed',
        items: body.items ?? [],
        effective_from: body.effective_from ?? 'next_billing_period',
        created_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.transactions, txn.id, txn);
      return reply.code(201).send(wrapResponse(txn));
    });

    server.post('/paddle/subscriptions/:id/charge/preview', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      return reply.code(200).send(wrapResponse({
        subscription_id: id,
        items: body.items ?? [],
        immediate_transaction: { subtotal: '1000', tax: '200', total: '1200' },
      }));
    });

    // ── Transactions ────────────────────────────────────────────────────

    server.post('/paddle/transactions', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const txn = {
        id: paddleId('txn'),
        status: 'draft',
        customer_id: body.customer_id ?? null,
        address_id: body.address_id ?? null,
        business_id: body.business_id ?? null,
        currency_code: body.currency_code ?? 'USD',
        discount_id: body.discount_id ?? null,
        items: body.items ?? [],
        details: { totals: { subtotal: '0', discount: '0', tax: '0', total: '0', grand_total: '0' } },
        checkout: body.checkout ?? null,
        custom_data: body.custom_data ?? null,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.transactions, txn.id, txn);
      return reply.code(201).send(wrapResponse(txn));
    });

    server.get('/paddle/transactions', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let txns = store.list<Record<string, unknown>>(NS.transactions);
      if (query.customer_id) txns = txns.filter((t) => t.customer_id === query.customer_id);
      if (query.subscription_id) txns = txns.filter((t) => t.subscription_id === query.subscription_id);
      if (query.status) txns = txns.filter((t) => t.status === query.status);
      return reply.code(200).send(wrapList(txns));
    });

    server.get('/paddle/transactions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const txn = store.get(NS.transactions, id);
      if (!txn) return reply.code(404).send(notFound('Transaction', id));
      return reply.code(200).send(wrapResponse(txn));
    });

    server.patch('/paddle/transactions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.transactions, id);
      if (!existing) return reply.code(404).send(notFound('Transaction', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.transactions, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.post('/paddle/transactions/preview', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      return reply.code(200).send(wrapResponse({
        customer_id: body.customer_id ?? null,
        address_id: body.address_id ?? null,
        currency_code: body.currency_code ?? 'USD',
        items: body.items ?? [],
        details: { totals: { subtotal: '1000', discount: '0', tax: '200', total: '1200', grand_total: '1200' } },
      }));
    });

    server.post('/paddle/transactions/:id/revise', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.transactions, id);
      if (!existing) return reply.code(404).send(notFound('Transaction', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.transactions, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.get('/paddle/transactions/:id/invoice', async (req, reply) => {
      const { id } = req.params as { id: string };
      const txn = store.get(NS.transactions, id);
      if (!txn) return reply.code(404).send(notFound('Transaction', id));
      return reply.code(200).send(wrapResponse({
        url: `https://paddle.com/invoices/${id}.pdf`,
      }));
    });

    // ── Adjustments ─────────────────────────────────────────────────────

    server.post('/paddle/adjustments', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const adj = {
        id: paddleId('adj'),
        action: body.action ?? 'refund',
        transaction_id: body.transaction_id ?? null,
        subscription_id: body.subscription_id ?? null,
        customer_id: body.customer_id ?? null,
        reason: body.reason ?? '',
        credit_applied_to_balance: body.credit_applied_to_balance ?? false,
        currency_code: body.currency_code ?? 'USD',
        status: 'approved',
        items: body.items ?? [],
        totals: { subtotal: '0', tax: '0', total: '0' },
        payout_totals: null,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.adjustments, adj.id, adj);
      return reply.code(201).send(wrapResponse(adj));
    });

    server.get('/paddle/adjustments', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let adjs = store.list<Record<string, unknown>>(NS.adjustments);
      if (query.transaction_id) adjs = adjs.filter((a) => a.transaction_id === query.transaction_id);
      if (query.subscription_id) adjs = adjs.filter((a) => a.subscription_id === query.subscription_id);
      return reply.code(200).send(wrapList(adjs));
    });

    server.get('/paddle/adjustments/:id/credit-note', async (req, reply) => {
      const { id } = req.params as { id: string };
      const adj = store.get(NS.adjustments, id);
      if (!adj) return reply.code(404).send(notFound('Adjustment', id));
      return reply.code(200).send(wrapResponse({
        url: `https://paddle.com/credit-notes/${id}.pdf`,
      }));
    });

    // ── Discounts ───────────────────────────────────────────────────────

    server.post('/paddle/discounts', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const discount = {
        id: paddleId('dsc'),
        status: 'active',
        description: body.description ?? '',
        enabled_for_checkout: body.enabled_for_checkout ?? true,
        code: body.code ?? null,
        type: body.type ?? 'percentage',
        amount: body.amount ?? '0',
        currency_code: body.currency_code ?? null,
        recur: body.recur ?? false,
        maximum_recurring_intervals: body.maximum_recurring_intervals ?? null,
        usage_limit: body.usage_limit ?? null,
        restrict_to: body.restrict_to ?? null,
        expires_at: body.expires_at ?? null,
        times_used: 0,
        custom_data: body.custom_data ?? null,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.discounts, discount.id, discount);
      return reply.code(201).send(wrapResponse(discount));
    });

    server.get('/paddle/discounts', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let discounts = store.list<Record<string, unknown>>(NS.discounts);
      if (query.status) discounts = discounts.filter((d) => d.status === query.status);
      if (query.code) discounts = discounts.filter((d) => d.code === query.code);
      return reply.code(200).send(wrapList(discounts));
    });

    server.get('/paddle/discounts/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const discount = store.get(NS.discounts, id);
      if (!discount) return reply.code(404).send(notFound('Discount', id));
      return reply.code(200).send(wrapResponse(discount));
    });

    server.patch('/paddle/discounts/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.discounts, id);
      if (!existing) return reply.code(404).send(notFound('Discount', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.discounts, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    // ── Discount Groups ─────────────────────────────────────────────────

    server.post('/paddle/discount-groups', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const group = {
        id: paddleId('dgrp'),
        status: 'active',
        name: body.name ?? '',
        description: body.description ?? null,
        discount_ids: body.discount_ids ?? [],
        custom_data: body.custom_data ?? null,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.discountGroups, group.id, group);
      return reply.code(201).send(wrapResponse(group));
    });

    server.get('/paddle/discount-groups', async (_req, reply) => {
      const groups = store.list(NS.discountGroups);
      return reply.code(200).send(wrapList(groups));
    });

    server.get('/paddle/discount-groups/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const group = store.get(NS.discountGroups, id);
      if (!group) return reply.code(404).send(notFound('Discount group', id));
      return reply.code(200).send(wrapResponse(group));
    });

    server.patch('/paddle/discount-groups/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.discountGroups, id);
      if (!existing) return reply.code(404).send(notFound('Discount group', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.discountGroups, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.post('/paddle/discount-groups/:id/archive', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.discountGroups, id);
      if (!existing) return reply.code(404).send(notFound('Discount group', id));
      const updated = { ...existing, status: 'archived', updated_at: isoNow() };
      store.set(NS.discountGroups, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    // ── Payment Methods ─────────────────────────────────────────────────

    server.get('/paddle/customers/:customerId/payment-methods', async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const methods = store.filter<Record<string, unknown>>(
        NS.paymentMethods,
        (m) => m.customer_id === customerId,
      );
      return reply.code(200).send(wrapList(methods));
    });

    server.get('/paddle/customers/:customerId/payment-methods/:id', async (req, reply) => {
      const { id } = req.params as { customerId: string; id: string };
      const method = store.get(NS.paymentMethods, id);
      if (!method) return reply.code(404).send(notFound('Payment method', id));
      return reply.code(200).send(wrapResponse(method));
    });

    server.delete('/paddle/customers/:customerId/payment-methods/:id', async (req, reply) => {
      const { id } = req.params as { customerId: string; id: string };
      store.delete(NS.paymentMethods, id);
      return reply.code(204).send();
    });

    // ── Customer Portal Sessions ────────────────────────────────────────

    server.post('/paddle/customers/:customerId/portal-sessions', async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const session = {
        id: paddleId('cps'),
        customer_id: customerId,
        urls: {
          general: { overview: `https://customer-portal.paddle.com/${customerId}/overview` },
        },
        created_at: isoNow(),
        ...body,
      };
      return reply.code(201).send(wrapResponse(session));
    });

    // ── Notifications ───────────────────────────────────────────────────

    server.get('/paddle/notifications', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let notifications = store.list<Record<string, unknown>>(NS.notifications);
      if (query.status) notifications = notifications.filter((n) => n.status === query.status);
      return reply.code(200).send(wrapList(notifications));
    });

    server.get('/paddle/notifications/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const notification = store.get(NS.notifications, id);
      if (!notification) return reply.code(404).send(notFound('Notification', id));
      return reply.code(200).send(wrapResponse(notification));
    });

    server.get('/paddle/notifications/:id/logs', async (req, reply) => {
      const { id } = req.params as { id: string };
      const notification = store.get(NS.notifications, id);
      if (!notification) return reply.code(404).send(notFound('Notification', id));
      return reply.code(200).send(wrapList([
        { id: paddleId('ntflog'), notification_id: id, status: 'delivered', attempted_at: isoNow() },
      ]));
    });

    server.post('/paddle/notifications/:id/replay', async (req, reply) => {
      const { id } = req.params as { id: string };
      const notification = store.get<Record<string, unknown>>(NS.notifications, id);
      if (!notification) return reply.code(404).send(notFound('Notification', id));
      return reply.code(200).send(wrapResponse({ ...notification, replayed_at: isoNow() }));
    });

    // ── Notification Settings ───────────────────────────────────────────

    server.post('/paddle/notification-settings', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const setting = {
        id: paddleId('ntfset'),
        description: body.description ?? '',
        destination: body.destination ?? '',
        type: body.type ?? 'url',
        subscribed_events: body.subscribed_events ?? [],
        active: true,
        api_version: body.api_version ?? 1,
        include_sensitive_fields: body.include_sensitive_fields ?? false,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.notificationSettings, setting.id, setting);
      return reply.code(201).send(wrapResponse(setting));
    });

    server.get('/paddle/notification-settings', async (_req, reply) => {
      const settings = store.list(NS.notificationSettings);
      return reply.code(200).send(wrapList(settings));
    });

    server.get('/paddle/notification-settings/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const setting = store.get(NS.notificationSettings, id);
      if (!setting) return reply.code(404).send(notFound('Notification setting', id));
      return reply.code(200).send(wrapResponse(setting));
    });

    server.patch('/paddle/notification-settings/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.notificationSettings, id);
      if (!existing) return reply.code(404).send(notFound('Notification setting', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.notificationSettings, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    server.delete('/paddle/notification-settings/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      store.delete(NS.notificationSettings, id);
      return reply.code(204).send();
    });

    // ── Events ──────────────────────────────────────────────────────────

    server.get('/paddle/events', async (_req, reply) => {
      const events = store.list(NS.events);
      return reply.code(200).send(wrapList(events));
    });

    // ── Simulations ─────────────────────────────────────────────────────

    server.post('/paddle/simulations', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sim = {
        id: paddleId('ntfsim'),
        status: 'active',
        name: body.name ?? '',
        type: body.type ?? 'single',
        notification_setting_id: body.notification_setting_id ?? null,
        scenario_type: body.scenario_type ?? null,
        payload: body.payload ?? null,
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.simulations, sim.id, sim);
      return reply.code(201).send(wrapResponse(sim));
    });

    server.get('/paddle/simulations', async (_req, reply) => {
      const sims = store.list(NS.simulations);
      return reply.code(200).send(wrapList(sims));
    });

    server.get('/paddle/simulations/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sim = store.get(NS.simulations, id);
      if (!sim) return reply.code(404).send(notFound('Simulation', id));
      return reply.code(200).send(wrapResponse(sim));
    });

    server.patch('/paddle/simulations/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.simulations, id);
      if (!existing) return reply.code(404).send(notFound('Simulation', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.simulations, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });

    // Simulation Runs
    server.post('/paddle/simulations/:id/runs', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sim = store.get(NS.simulations, id);
      if (!sim) return reply.code(404).send(notFound('Simulation', id));
      const run = {
        id: paddleId('ntfsimrun'),
        simulation_id: id,
        status: 'completed',
        created_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.simulationRuns, run.id, run);
      return reply.code(201).send(wrapResponse(run));
    });

    server.get('/paddle/simulations/:id/runs', async (req, reply) => {
      const { id } = req.params as { id: string };
      const runs = store.filter<Record<string, unknown>>(
        NS.simulationRuns,
        (r) => r.simulation_id === id,
      );
      return reply.code(200).send(wrapList(runs));
    });

    server.get('/paddle/simulations/:id/runs/:runId', async (req, reply) => {
      const { runId } = req.params as { id: string; runId: string };
      const run = store.get(NS.simulationRuns, runId);
      if (!run) return reply.code(404).send(notFound('Simulation run', runId));
      return reply.code(200).send(wrapResponse(run));
    });

    // Simulation Run Events
    server.get('/paddle/simulations/:id/runs/:runId/events', async (req, reply) => {
      const { runId } = req.params as { id: string; runId: string };
      const events = store.filter<Record<string, unknown>>(
        NS.simulationRunEvents,
        (e) => e.run_id === runId,
      );
      return reply.code(200).send(wrapList(events));
    });

    server.get('/paddle/simulations/:id/runs/:runId/events/:eventId', async (req, reply) => {
      const { eventId } = req.params as { id: string; runId: string; eventId: string };
      const event = store.get(NS.simulationRunEvents, eventId);
      if (!event) return reply.code(404).send(notFound('Simulation run event', eventId));
      return reply.code(200).send(wrapResponse(event));
    });

    server.post('/paddle/simulations/:id/runs/:runId/events/:eventId/replay', async (req, reply) => {
      const { eventId } = req.params as { id: string; runId: string; eventId: string };
      const event = store.get<Record<string, unknown>>(NS.simulationRunEvents, eventId);
      if (!event) return reply.code(404).send(notFound('Simulation run event', eventId));
      return reply.code(200).send(wrapResponse({ ...event, replayed_at: isoNow() }));
    });

    // ── Reports ─────────────────────────────────────────────────────────

    server.post('/paddle/reports', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const report = {
        id: paddleId('rep'),
        status: 'ready',
        type: body.type ?? 'transactions',
        filters: body.filters ?? [],
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        created_at: isoNow(),
        updated_at: isoNow(),
        ...body,
      };
      store.set(NS.reports, report.id, report);
      return reply.code(201).send(wrapResponse(report));
    });

    server.get('/paddle/reports', async (_req, reply) => {
      const reports = store.list(NS.reports);
      return reply.code(200).send(wrapList(reports));
    });

    server.get('/paddle/reports/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const report = store.get(NS.reports, id);
      if (!report) return reply.code(404).send(notFound('Report', id));
      return reply.code(200).send(wrapResponse(report));
    });

    server.get('/paddle/reports/:id/csv', async (req, reply) => {
      const { id } = req.params as { id: string };
      const report = store.get(NS.reports, id);
      if (!report) return reply.code(404).send(notFound('Report', id));
      return reply.code(200).send(wrapResponse({
        url: `https://paddle.com/reports/${id}.csv`,
      }));
    });

    // ── Client-Side Tokens ──────────────────────────────────────────────

    server.post('/paddle/client-side-tokens', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = {
        id: paddleId('ctok'),
        token: `pdl_cst_${generateId('', 32)}`,
        status: 'active',
        customer_id: body.customer_id ?? null,
        allowed_origins: body.allowed_origins ?? [],
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        created_at: isoNow(),
        ...body,
      };
      store.set(NS.clientSideTokens, token.id, token);
      return reply.code(201).send(wrapResponse(token));
    });

    server.get('/paddle/client-side-tokens', async (_req, reply) => {
      const tokens = store.list(NS.clientSideTokens);
      return reply.code(200).send(wrapList(tokens));
    });

    server.get('/paddle/client-side-tokens/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const token = store.get(NS.clientSideTokens, id);
      if (!token) return reply.code(404).send(notFound('Client-side token', id));
      return reply.code(200).send(wrapResponse(token));
    });

    server.post('/paddle/client-side-tokens/:id/revoke', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.clientSideTokens, id);
      if (!existing) return reply.code(404).send(notFound('Client-side token', id));
      const updated = { ...existing, status: 'revoked', updated_at: isoNow() };
      store.set(NS.clientSideTokens, id, updated);
      return reply.code(200).send(wrapResponse(updated));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Products & Prices
      { method: 'POST', path: '/paddle/products', description: 'Create product' },
      { method: 'GET', path: '/paddle/products', description: 'List products' },
      { method: 'GET', path: '/paddle/products/:id', description: 'Get product' },
      { method: 'PATCH', path: '/paddle/products/:id', description: 'Update product' },
      { method: 'POST', path: '/paddle/prices', description: 'Create price' },
      { method: 'GET', path: '/paddle/prices', description: 'List prices' },
      { method: 'GET', path: '/paddle/prices/:id', description: 'Get price' },
      { method: 'PATCH', path: '/paddle/prices/:id', description: 'Update price' },
      { method: 'POST', path: '/paddle/pricing-preview', description: 'Preview prices' },

      // Customers
      { method: 'POST', path: '/paddle/customers', description: 'Create customer' },
      { method: 'GET', path: '/paddle/customers', description: 'List customers' },
      { method: 'GET', path: '/paddle/customers/:id', description: 'Get customer' },
      { method: 'PATCH', path: '/paddle/customers/:id', description: 'Update customer' },
      { method: 'GET', path: '/paddle/customers/:id/credit-balances', description: 'List credit balances' },

      // Addresses
      { method: 'POST', path: '/paddle/customers/:customerId/addresses', description: 'Create address' },
      { method: 'GET', path: '/paddle/customers/:customerId/addresses', description: 'List addresses' },
      { method: 'GET', path: '/paddle/customers/:customerId/addresses/:id', description: 'Get address' },
      { method: 'PATCH', path: '/paddle/customers/:customerId/addresses/:id', description: 'Update address' },

      // Businesses
      { method: 'POST', path: '/paddle/customers/:customerId/businesses', description: 'Create business' },
      { method: 'GET', path: '/paddle/customers/:customerId/businesses', description: 'List businesses' },
      { method: 'GET', path: '/paddle/customers/:customerId/businesses/:id', description: 'Get business' },
      { method: 'PATCH', path: '/paddle/customers/:customerId/businesses/:id', description: 'Update business' },

      // Subscriptions
      { method: 'GET', path: '/paddle/subscriptions', description: 'List subscriptions' },
      { method: 'GET', path: '/paddle/subscriptions/:id', description: 'Get subscription' },
      { method: 'PATCH', path: '/paddle/subscriptions/:id', description: 'Update subscription' },
      { method: 'POST', path: '/paddle/subscriptions/:id/pause', description: 'Pause subscription' },
      { method: 'POST', path: '/paddle/subscriptions/:id/resume', description: 'Resume subscription' },
      { method: 'POST', path: '/paddle/subscriptions/:id/cancel', description: 'Cancel subscription' },
      { method: 'POST', path: '/paddle/subscriptions/:id/activate', description: 'Activate subscription' },
      { method: 'GET', path: '/paddle/subscriptions/:id/update-payment-method-transaction', description: 'Preview subscription update' },
      { method: 'POST', path: '/paddle/subscriptions/:id/charge', description: 'Create subscription charge' },
      { method: 'POST', path: '/paddle/subscriptions/:id/charge/preview', description: 'Preview subscription charge' },

      // Transactions
      { method: 'POST', path: '/paddle/transactions', description: 'Create transaction' },
      { method: 'GET', path: '/paddle/transactions', description: 'List transactions' },
      { method: 'GET', path: '/paddle/transactions/:id', description: 'Get transaction' },
      { method: 'PATCH', path: '/paddle/transactions/:id', description: 'Update transaction' },
      { method: 'POST', path: '/paddle/transactions/preview', description: 'Preview transaction' },
      { method: 'POST', path: '/paddle/transactions/:id/revise', description: 'Revise transaction' },
      { method: 'GET', path: '/paddle/transactions/:id/invoice', description: 'Get transaction invoice' },

      // Adjustments
      { method: 'POST', path: '/paddle/adjustments', description: 'Create adjustment' },
      { method: 'GET', path: '/paddle/adjustments', description: 'List adjustments' },
      { method: 'GET', path: '/paddle/adjustments/:id/credit-note', description: 'Get adjustment credit note' },

      // Discounts
      { method: 'POST', path: '/paddle/discounts', description: 'Create discount' },
      { method: 'GET', path: '/paddle/discounts', description: 'List discounts' },
      { method: 'GET', path: '/paddle/discounts/:id', description: 'Get discount' },
      { method: 'PATCH', path: '/paddle/discounts/:id', description: 'Update discount' },

      // Discount Groups
      { method: 'POST', path: '/paddle/discount-groups', description: 'Create discount group' },
      { method: 'GET', path: '/paddle/discount-groups', description: 'List discount groups' },
      { method: 'GET', path: '/paddle/discount-groups/:id', description: 'Get discount group' },
      { method: 'PATCH', path: '/paddle/discount-groups/:id', description: 'Update discount group' },
      { method: 'POST', path: '/paddle/discount-groups/:id/archive', description: 'Archive discount group' },

      // Payment Methods
      { method: 'GET', path: '/paddle/customers/:customerId/payment-methods', description: 'List saved payment methods' },
      { method: 'GET', path: '/paddle/customers/:customerId/payment-methods/:id', description: 'Get saved payment method' },
      { method: 'DELETE', path: '/paddle/customers/:customerId/payment-methods/:id', description: 'Delete saved payment method' },

      // Customer Portal
      { method: 'POST', path: '/paddle/customers/:customerId/portal-sessions', description: 'Create customer portal session' },

      // Notifications
      { method: 'GET', path: '/paddle/notifications', description: 'List notifications' },
      { method: 'GET', path: '/paddle/notifications/:id', description: 'Get notification' },
      { method: 'GET', path: '/paddle/notifications/:id/logs', description: 'List notification logs' },
      { method: 'POST', path: '/paddle/notifications/:id/replay', description: 'Replay notification' },

      // Notification Settings
      { method: 'POST', path: '/paddle/notification-settings', description: 'Create notification setting' },
      { method: 'GET', path: '/paddle/notification-settings', description: 'List notification settings' },
      { method: 'GET', path: '/paddle/notification-settings/:id', description: 'Get notification setting' },
      { method: 'PATCH', path: '/paddle/notification-settings/:id', description: 'Update notification setting' },
      { method: 'DELETE', path: '/paddle/notification-settings/:id', description: 'Delete notification setting' },

      // Events
      { method: 'GET', path: '/paddle/events', description: 'List events' },

      // Simulations
      { method: 'POST', path: '/paddle/simulations', description: 'Create simulation' },
      { method: 'GET', path: '/paddle/simulations', description: 'List simulations' },
      { method: 'GET', path: '/paddle/simulations/:id', description: 'Get simulation' },
      { method: 'PATCH', path: '/paddle/simulations/:id', description: 'Update simulation' },
      { method: 'POST', path: '/paddle/simulations/:id/runs', description: 'Create simulation run' },
      { method: 'GET', path: '/paddle/simulations/:id/runs', description: 'List simulation runs' },
      { method: 'GET', path: '/paddle/simulations/:id/runs/:runId', description: 'Get simulation run' },
      { method: 'GET', path: '/paddle/simulations/:id/runs/:runId/events', description: 'List simulation run events' },
      { method: 'GET', path: '/paddle/simulations/:id/runs/:runId/events/:eventId', description: 'Get simulation run event' },
      { method: 'POST', path: '/paddle/simulations/:id/runs/:runId/events/:eventId/replay', description: 'Replay simulation run event' },

      // Reports
      { method: 'POST', path: '/paddle/reports', description: 'Create report' },
      { method: 'GET', path: '/paddle/reports', description: 'List reports' },
      { method: 'GET', path: '/paddle/reports/:id', description: 'Get report' },
      { method: 'GET', path: '/paddle/reports/:id/csv', description: 'Get report CSV' },

      // Client-Side Tokens
      { method: 'POST', path: '/paddle/client-side-tokens', description: 'Create client-side token' },
      { method: 'GET', path: '/paddle/client-side-tokens', description: 'List client-side tokens' },
      { method: 'GET', path: '/paddle/client-side-tokens/:id', description: 'Get client-side token' },
      { method: 'POST', path: '/paddle/client-side-tokens/:id/revoke', description: 'Revoke client-side token' },
    ];
  }

  // ── Cross-surface seeding ────────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    products: NS.products,
    prices: NS.prices,
    customers: NS.customers,
    addresses: NS.addresses,
    businesses: NS.businesses,
    subscriptions: NS.subscriptions,
    transactions: NS.transactions,
    adjustments: NS.adjustments,
    discounts: NS.discounts,
    discount_groups: NS.discountGroups,
    notifications: NS.notifications,
    notification_settings: NS.notificationSettings,
    events: NS.events,
    reports: NS.reports,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const paddleData = expanded.apiResponses?.paddle;
      if (!paddleData) continue;

      for (const [resourceType, responses] of Object.entries(
        paddleData.responses,
      )) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          if (!body.id) continue;

          const enriched = {
            created_at: body.created_at ?? isoNow(),
            updated_at: body.updated_at ?? isoNow(),
            ...body,
          };

          store.set(namespace, String(body.id), enriched);
        }
      }
    }
  }
}
