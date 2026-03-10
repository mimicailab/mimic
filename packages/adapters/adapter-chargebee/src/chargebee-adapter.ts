import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId, unixNow } from '@mimicai/adapter-sdk';
import type { ChargebeeConfig } from './config.js';
import { notFound } from './chargebee-errors.js';
import { registerChargebeeTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  subscriptions: 'cb_subscriptions',
  customers: 'cb_customers',
  items: 'cb_items',
  itemPrices: 'cb_item_prices',
  itemFamilies: 'cb_item_families',
  invoices: 'cb_invoices',
  creditNotes: 'cb_credit_notes',
  coupons: 'cb_coupons',
  usages: 'cb_usages',
  paymentSources: 'cb_payment_sources',
  transactions: 'cb_transactions',
  events: 'cb_events',
  quotes: 'cb_quotes',
  unbilledCharges: 'cb_unbilled_charges',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BP = '/chargebee/api/v2';

function cbId(prefix: string): string {
  return `${prefix}_${generateId('', 14)}`;
}

function resourceVersion(): number {
  return Date.now() * 1000;
}

/** Chargebee wraps single objects: `{ subscription: {...} }` */
function wrapSingle(type: string, obj: unknown, extras?: Record<string, unknown>) {
  return { [type]: obj, ...extras };
}

/** Chargebee list: `{ list: [{ subscription: {...} }, ...], next_offset?: "..." }` */
function wrapList(type: string, items: unknown[], nextOffset?: string) {
  return {
    list: items.map((item) => ({ [type]: item })),
    ...(nextOffset ? { next_offset: nextOffset } : {}),
  };
}

// ---------------------------------------------------------------------------
// Chargebee Adapter
// ---------------------------------------------------------------------------

export class ChargebeeAdapter extends BaseApiMockAdapter<ChargebeeConfig> {
  readonly id = 'chargebee';
  readonly name = 'Chargebee API';
  readonly basePath = '/chargebee/api/v2';
  readonly versions = ['2'];

  readonly promptContext = {
    resources: ['customers', 'subscriptions', 'items', 'item_prices', 'invoices', 'credit_notes', 'coupons', 'payment_sources', 'transactions'],
    amountFormat: 'integer cents (e.g. 2999 = $29.99)',
    relationships: [
      'subscription → customer, item_price',
      'invoice → customer, subscription',
      'credit_note → customer, invoice',
      'transaction → customer, invoice',
      'payment_source → customer',
    ],
    requiredFields: {
      customers: ['id', 'email', 'first_name', 'last_name', 'created_at'],
      subscriptions: ['id', 'customer_id', 'status', 'plan_id', 'plan_amount', 'currency_code', 'created_at'],
      items: ['id', 'name', 'type', 'status'],
      item_prices: ['id', 'item_id', 'name', 'pricing_model', 'price', 'currency_code'],
      invoices: ['id', 'customer_id', 'subscription_id', 'status', 'total', 'amount_due', 'currency_code', 'date'],
      transactions: ['id', 'customer_id', 'type', 'amount', 'currency_code', 'status', 'date'],
    },
    notes: 'Amounts in cents. Timestamps are Unix seconds. Subscription status: active, in_trial, cancelled, non_renewing, paused. Uses item_price model (not legacy plan model).',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'unix_seconds',
    amountFields: ['amount', 'amount_due', 'total', 'price', 'plan_amount'],
    statusEnums: {
      subscriptions: ['active', 'in_trial', 'cancelled', 'non_renewing', 'paused'],
      invoices: ['paid', 'posted', 'payment_due', 'not_paid', 'voided', 'pending'],
    },
    timestampFields: ['created_at', 'updated_at', 'date', 'next_billing_at', 'activated_at', 'cancelled_at'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerChargebeeTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    // Chargebee uses HTTP Basic auth: api_key as username, empty password
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Basic\s+(.+)$/);
    if (!match) return null;
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
      const key = decoded.split(':')[0];
      const personaMatch = key.match(/^test_([a-z0-9-]+)_/);
      return personaMatch ? personaMatch[1] : null;
    } catch {
      return null;
    }
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    this.seedFromApiResponses(data, store);

    // ── Subscriptions ───────────────────────────────────────────────────

    server.post(`${BP}/subscriptions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const id = (body.id as string) || cbId('sub');
      const sub = {
        id,
        customer_id: body.customer_id ?? null,
        status: 'active',
        current_term_start: now,
        current_term_end: now + 30 * 86400,
        created_at: now,
        updated_at: now,
        resource_version: resourceVersion(),
        subscription_items: body.subscription_items ?? [],
        ...body,
      };
      store.set(NS.subscriptions, sub.id, sub);

      // Auto-generate invoice
      const inv = {
        id: cbId('inv'),
        subscription_id: sub.id,
        customer_id: sub.customer_id,
        status: 'paid',
        total: 0,
        amount_paid: 0,
        amount_due: 0,
        currency_code: (body.currency_code as string) ?? 'USD',
        date: now,
        created_at: now,
        updated_at: now,
        resource_version: resourceVersion(),
      };
      store.set(NS.invoices, inv.id, inv);

      return reply.code(200).send(wrapSingle('subscription', sub, { invoice: inv }));
    });

    server.get(`${BP}/subscriptions/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.code(404).send(notFound('Subscription', id));
      return reply.code(200).send(wrapSingle('subscription', sub));
    });

    server.get(`${BP}/subscriptions`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let subs = store.list<Record<string, unknown>>(NS.subscriptions);
      if (query['customer_id[is]']) subs = subs.filter((s) => s.customer_id === query['customer_id[is]']);
      if (query['status[is]']) subs = subs.filter((s) => s.status === query['status[is]']);
      if (query['status[in]']) {
        const statuses = query['status[in]'].replace(/[[\]]/g, '').split(',');
        subs = subs.filter((s) => statuses.includes(s.status as string));
      }
      const limit = query.limit ? parseInt(query.limit, 10) : 100;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      const page = subs.slice(offset, offset + limit);
      const nextOffset = offset + limit < subs.length ? String(offset + limit) : undefined;
      return reply.code(200).send(wrapList('subscription', page, nextOffset));
    });

    server.post(`${BP}/subscriptions/:id/cancel`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const endOfTerm = body.end_of_term === true || body.end_of_term === 'true';
      const updated = {
        ...existing,
        status: endOfTerm ? 'non_renewing' : 'cancelled',
        cancelled_at: endOfTerm ? null : unixNow(),
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapSingle('subscription', updated));
    });

    server.post(`${BP}/subscriptions/:id/reactivate`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = {
        ...existing,
        status: 'active',
        cancelled_at: null,
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapSingle('subscription', updated));
    });

    server.post(`${BP}/subscriptions/:id/pause`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = {
        ...existing,
        ...body,
        status: 'paused',
        paused_at: unixNow(),
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapSingle('subscription', updated));
    });

    server.post(`${BP}/subscriptions/:id/resume`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = {
        ...existing,
        status: 'active',
        paused_at: null,
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapSingle('subscription', updated));
    });

    server.post(`${BP}/subscriptions/:id/change_term_end`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = {
        ...existing,
        current_term_end: body.term_ends_at ?? existing.current_term_end,
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapSingle('subscription', updated));
    });

    server.post(`${BP}/subscriptions/:id/update`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = {
        ...existing,
        ...body,
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(wrapSingle('subscription', updated));
    });

    // ── Customers ───────────────────────────────────────────────────────

    server.post(`${BP}/customers`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const customer = {
        id: (body.id as string) || cbId('cust'),
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
        email: body.email ?? null,
        company: body.company ?? null,
        locale: body.locale ?? null,
        auto_collection: body.auto_collection ?? 'on',
        created_at: now,
        updated_at: now,
        resource_version: resourceVersion(),
        ...body,
      };
      store.set(NS.customers, customer.id, customer);
      return reply.code(200).send(wrapSingle('customer', customer));
    });

    server.get(`${BP}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get(NS.customers, id);
      if (!customer) return reply.code(404).send(notFound('Customer', id));
      return reply.code(200).send(wrapSingle('customer', customer));
    });

    server.get(`${BP}/customers`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let customers = store.list<Record<string, unknown>>(NS.customers);
      if (query['email[is]']) customers = customers.filter((c) => c.email === query['email[is]']);
      const limit = query.limit ? parseInt(query.limit, 10) : 100;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      const page = customers.slice(offset, offset + limit);
      const nextOffset = offset + limit < customers.length ? String(offset + limit) : undefined;
      return reply.code(200).send(wrapList('customer', page, nextOffset));
    });

    server.post(`${BP}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.customers, id);
      if (!existing) return reply.code(404).send(notFound('Customer', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: unixNow(), resource_version: resourceVersion() };
      store.set(NS.customers, id, updated);
      return reply.code(200).send(wrapSingle('customer', updated));
    });

    // ── Items (Product Catalog 2.0) ─────────────────────────────────────

    server.post(`${BP}/items`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const item = {
        id: (body.id as string) || cbId('item'),
        name: body.name ?? '',
        type: body.type ?? 'plan',
        status: 'active',
        item_family_id: body.item_family_id ?? null,
        description: body.description ?? null,
        is_shippable: body.is_shippable ?? false,
        is_giftable: body.is_giftable ?? false,
        enabled_for_checkout: body.enabled_for_checkout ?? true,
        enabled_in_portal: body.enabled_in_portal ?? true,
        resource_version: resourceVersion(),
        updated_at: unixNow(),
        ...body,
      };
      store.set(NS.items, item.id, item);
      return reply.code(200).send(wrapSingle('item', item));
    });

    server.get(`${BP}/items/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const item = store.get(NS.items, id);
      if (!item) return reply.code(404).send(notFound('Item', id));
      return reply.code(200).send(wrapSingle('item', item));
    });

    server.get(`${BP}/items`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let items = store.list<Record<string, unknown>>(NS.items);
      if (query['type[is]']) items = items.filter((i) => i.type === query['type[is]']);
      if (query['item_family_id[is]']) items = items.filter((i) => i.item_family_id === query['item_family_id[is]']);
      return reply.code(200).send(wrapList('item', items));
    });

    // ── Item Prices ─────────────────────────────────────────────────────

    server.post(`${BP}/item_prices`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const itemPrice = {
        id: (body.id as string) || cbId('iprice'),
        name: body.name ?? '',
        item_id: body.item_id ?? null,
        pricing_model: body.pricing_model ?? 'flat_fee',
        price: body.price ?? 0,
        period: body.period ?? 1,
        period_unit: body.period_unit ?? 'month',
        currency_code: body.currency_code ?? 'USD',
        status: 'active',
        trial_period: body.trial_period ?? null,
        trial_period_unit: body.trial_period_unit ?? null,
        free_quantity: body.free_quantity ?? 0,
        resource_version: resourceVersion(),
        updated_at: unixNow(),
        ...body,
      };
      store.set(NS.itemPrices, itemPrice.id, itemPrice);
      return reply.code(200).send(wrapSingle('item_price', itemPrice));
    });

    server.get(`${BP}/item_prices/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const itemPrice = store.get(NS.itemPrices, id);
      if (!itemPrice) return reply.code(404).send(notFound('Item price', id));
      return reply.code(200).send(wrapSingle('item_price', itemPrice));
    });

    server.get(`${BP}/item_prices`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let prices = store.list<Record<string, unknown>>(NS.itemPrices);
      if (query['item_id[is]']) prices = prices.filter((p) => p.item_id === query['item_id[is]']);
      return reply.code(200).send(wrapList('item_price', prices));
    });

    // ── Item Families ───────────────────────────────────────────────────

    server.post(`${BP}/item_families`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const family = {
        id: (body.id as string) || cbId('ifam'),
        name: body.name ?? '',
        description: body.description ?? null,
        status: 'active',
        resource_version: resourceVersion(),
        updated_at: unixNow(),
        ...body,
      };
      store.set(NS.itemFamilies, family.id, family);
      return reply.code(200).send(wrapSingle('item_family', family));
    });

    server.get(`${BP}/item_families/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const family = store.get(NS.itemFamilies, id);
      if (!family) return reply.code(404).send(notFound('Item family', id));
      return reply.code(200).send(wrapSingle('item_family', family));
    });

    server.get(`${BP}/item_families`, async (_req, reply) => {
      const families = store.list(NS.itemFamilies);
      return reply.code(200).send(wrapList('item_family', families));
    });

    // ── Invoices ────────────────────────────────────────────────────────

    server.get(`${BP}/invoices/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      return reply.code(200).send(wrapSingle('invoice', invoice));
    });

    server.get(`${BP}/invoices`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let invoices = store.list<Record<string, unknown>>(NS.invoices);
      if (query['customer_id[is]']) invoices = invoices.filter((i) => i.customer_id === query['customer_id[is]']);
      if (query['subscription_id[is]']) invoices = invoices.filter((i) => i.subscription_id === query['subscription_id[is]']);
      if (query['status[is]']) invoices = invoices.filter((i) => i.status === query['status[is]']);
      return reply.code(200).send(wrapList('invoice', invoices));
    });

    server.post(`${BP}/invoices/:id/collect_payment`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get<Record<string, unknown>>(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      const updated = {
        ...invoice,
        status: 'paid',
        amount_paid: invoice.total ?? 0,
        amount_due: 0,
        paid_at: unixNow(),
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.invoices, id, updated);
      return reply.code(200).send(wrapSingle('invoice', updated));
    });

    server.post(`${BP}/invoices/:id/void`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get<Record<string, unknown>>(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      const updated = {
        ...invoice,
        status: 'voided',
        voided_at: unixNow(),
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.invoices, id, updated);
      return reply.code(200).send(wrapSingle('invoice', updated));
    });

    server.post(`${BP}/invoices/:id/write_off`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get<Record<string, unknown>>(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      const updated = {
        ...invoice,
        write_off_amount: invoice.amount_due ?? 0,
        amount_due: 0,
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.invoices, id, updated);
      return reply.code(200).send(wrapSingle('invoice', updated));
    });

    server.get(`${BP}/invoices/:id/pdf`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get(NS.invoices, id);
      if (!invoice) return reply.code(404).send(notFound('Invoice', id));
      return reply.code(200).send({
        download: { download_url: `https://chargebee.com/invoices/${id}.pdf` },
      });
    });

    // ── Credit Notes ────────────────────────────────────────────────────

    server.post(`${BP}/credit_notes`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const cn = {
        id: cbId('cn'),
        reference_invoice_id: body.reference_invoice_id ?? null,
        customer_id: body.customer_id ?? null,
        type: body.type ?? 'adjustment',
        reason_code: body.reason_code ?? 'other',
        status: 'adjusted',
        total: body.total ?? 0,
        amount_allocated: 0,
        amount_refunded: 0,
        amount_available: body.total ?? 0,
        date: now,
        currency_code: body.currency_code ?? 'USD',
        created_at: now,
        updated_at: now,
        resource_version: resourceVersion(),
        ...body,
      };
      store.set(NS.creditNotes, cn.id, cn);
      return reply.code(200).send(wrapSingle('credit_note', cn));
    });

    server.get(`${BP}/credit_notes/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const cn = store.get(NS.creditNotes, id);
      if (!cn) return reply.code(404).send(notFound('Credit note', id));
      return reply.code(200).send(wrapSingle('credit_note', cn));
    });

    server.get(`${BP}/credit_notes`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let notes = store.list<Record<string, unknown>>(NS.creditNotes);
      if (query['customer_id[is]']) notes = notes.filter((n) => n.customer_id === query['customer_id[is]']);
      return reply.code(200).send(wrapList('credit_note', notes));
    });

    // ── Coupons ─────────────────────────────────────────────────────────

    server.post(`${BP}/coupons`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const coupon = {
        id: (body.id as string) || cbId('coupon'),
        name: body.name ?? '',
        discount_type: body.discount_type ?? 'percentage',
        discount_percentage: body.discount_percentage ?? null,
        discount_amount: body.discount_amount ?? null,
        currency_code: body.currency_code ?? null,
        duration_type: body.duration_type ?? 'one_time',
        max_redemptions: body.max_redemptions ?? null,
        redemptions: 0,
        status: 'active',
        apply_on: body.apply_on ?? 'invoice_amount',
        created_at: unixNow(),
        updated_at: unixNow(),
        resource_version: resourceVersion(),
        ...body,
      };
      store.set(NS.coupons, coupon.id, coupon);
      return reply.code(200).send(wrapSingle('coupon', coupon));
    });

    server.get(`${BP}/coupons/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const coupon = store.get(NS.coupons, id);
      if (!coupon) return reply.code(404).send(notFound('Coupon', id));
      return reply.code(200).send(wrapSingle('coupon', coupon));
    });

    server.get(`${BP}/coupons`, async (_req, reply) => {
      const coupons = store.list(NS.coupons);
      return reply.code(200).send(wrapList('coupon', coupons));
    });

    server.post(`${BP}/coupons/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.coupons, id);
      if (!existing) return reply.code(404).send(notFound('Coupon', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: unixNow(), resource_version: resourceVersion() };
      store.set(NS.coupons, id, updated);
      return reply.code(200).send(wrapSingle('coupon', updated));
    });

    server.delete(`${BP}/coupons/:id/delete`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.coupons, id);
      if (!existing) return reply.code(404).send(notFound('Coupon', id));
      store.delete(NS.coupons, id);
      return reply.code(200).send(wrapSingle('coupon', { ...existing, status: 'archived' }));
    });

    // ── Usage ───────────────────────────────────────────────────────────

    server.post(`${BP}/subscriptions/:id/usages`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const usage = {
        id: cbId('usage'),
        subscription_id: id,
        item_price_id: body.item_price_id ?? null,
        quantity: body.quantity ?? '0',
        usage_date: body.usage_date ?? unixNow(),
        created_at: unixNow(),
        resource_version: resourceVersion(),
        ...body,
      };
      store.set(NS.usages, usage.id, usage);
      return reply.code(200).send(wrapSingle('usage', usage));
    });

    server.get(`${BP}/subscriptions/:id/usages`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const usages = store.filter<Record<string, unknown>>(
        NS.usages,
        (u) => u.subscription_id === id,
      );
      return reply.code(200).send(wrapList('usage', usages));
    });

    server.delete(`${BP}/usages/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.usages, id);
      if (!existing) return reply.code(404).send(notFound('Usage', id));
      store.delete(NS.usages, id);
      return reply.code(200).send(wrapSingle('usage', existing));
    });

    // ── Payment Sources ─────────────────────────────────────────────────

    server.post(`${BP}/payment_sources`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const ps = {
        id: cbId('pm'),
        customer_id: body.customer_id ?? null,
        type: body.type ?? 'card',
        status: 'valid',
        gateway: body.gateway ?? 'chargebee',
        reference_id: body.reference_id ?? cbId('ref'),
        created_at: unixNow(),
        updated_at: unixNow(),
        resource_version: resourceVersion(),
        ...body,
      };
      store.set(NS.paymentSources, ps.id, ps);
      return reply.code(200).send(wrapSingle('payment_source', ps));
    });

    server.get(`${BP}/payment_sources`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let sources = store.list<Record<string, unknown>>(NS.paymentSources);
      if (query['customer_id[is]']) sources = sources.filter((s) => s.customer_id === query['customer_id[is]']);
      return reply.code(200).send(wrapList('payment_source', sources));
    });

    server.delete(`${BP}/payment_sources/:id/delete`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.paymentSources, id);
      if (!existing) return reply.code(404).send(notFound('Payment source', id));
      store.delete(NS.paymentSources, id);
      return reply.code(200).send(wrapSingle('payment_source', existing));
    });

    // ── Transactions ────────────────────────────────────────────────────

    server.get(`${BP}/transactions/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const txn = store.get(NS.transactions, id);
      if (!txn) return reply.code(404).send(notFound('Transaction', id));
      return reply.code(200).send(wrapSingle('transaction', txn));
    });

    server.get(`${BP}/transactions`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let txns = store.list<Record<string, unknown>>(NS.transactions);
      if (query['customer_id[is]']) txns = txns.filter((t) => t.customer_id === query['customer_id[is]']);
      return reply.code(200).send(wrapList('transaction', txns));
    });

    // ── Events ──────────────────────────────────────────────────────────

    server.get(`${BP}/events/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const event = store.get(NS.events, id);
      if (!event) return reply.code(404).send(notFound('Event', id));
      return reply.code(200).send(wrapSingle('event', event));
    });

    server.get(`${BP}/events`, async (_req, reply) => {
      const events = store.list(NS.events);
      return reply.code(200).send(wrapList('event', events));
    });

    // ── Hosted Pages ────────────────────────────────────────────────────

    server.post(`${BP}/hosted_pages/checkout_new`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const page = {
        id: cbId('hp'),
        type: 'checkout_new',
        url: `https://test-site.chargebee.com/pages/v3/${cbId('hp')}`,
        state: 'created',
        created_at: unixNow(),
        expires_at: unixNow() + 3600,
        ...body,
      };
      return reply.code(200).send(wrapSingle('hosted_page', page));
    });

    server.post(`${BP}/hosted_pages/manage_payment_sources`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const page = {
        id: cbId('hp'),
        type: 'manage_payment_sources',
        url: `https://test-site.chargebee.com/pages/v3/${cbId('hp')}`,
        state: 'created',
        created_at: unixNow(),
        expires_at: unixNow() + 3600,
        ...body,
      };
      return reply.code(200).send(wrapSingle('hosted_page', page));
    });

    // ── Portal Sessions ─────────────────────────────────────────────────

    server.post(`${BP}/portal_sessions`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const session = {
        id: cbId('ps'),
        token: generateId('portal_', 32),
        access_url: `https://test-site.chargebeeportal.com/portal/v2/access/${cbId('ps')}`,
        status: 'created',
        customer_id: body.customer_id ?? null,
        created_at: unixNow(),
        expires_at: unixNow() + 3600,
        ...body,
      };
      return reply.code(200).send(wrapSingle('portal_session', session));
    });

    // ── Quotes ──────────────────────────────────────────────────────────

    server.post(`${BP}/quotes`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = unixNow();
      const quote = {
        id: cbId('qt'),
        name: body.name ?? null,
        customer_id: body.customer_id ?? null,
        subscription_id: body.subscription_id ?? null,
        status: 'open',
        operation_type: body.operation_type ?? 'create_subscription_for_customer',
        amount: body.amount ?? 0,
        currency_code: body.currency_code ?? 'USD',
        valid_till: now + 30 * 86400,
        date: now,
        created_at: now,
        updated_at: now,
        resource_version: resourceVersion(),
        ...body,
      };
      store.set(NS.quotes, quote.id, quote);
      return reply.code(200).send(wrapSingle('quote', quote));
    });

    server.get(`${BP}/quotes/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const quote = store.get(NS.quotes, id);
      if (!quote) return reply.code(404).send(notFound('Quote', id));
      return reply.code(200).send(wrapSingle('quote', quote));
    });

    server.get(`${BP}/quotes`, async (_req, reply) => {
      const quotes = store.list(NS.quotes);
      return reply.code(200).send(wrapList('quote', quotes));
    });

    server.post(`${BP}/quotes/:id/convert`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const quote = store.get<Record<string, unknown>>(NS.quotes, id);
      if (!quote) return reply.code(404).send(notFound('Quote', id));

      const updated = { ...quote, status: 'accepted', updated_at: unixNow(), resource_version: resourceVersion() };
      store.set(NS.quotes, id, updated);

      // Create subscription from quote
      const sub = {
        id: cbId('sub'),
        customer_id: quote.customer_id,
        status: 'active',
        current_term_start: unixNow(),
        current_term_end: unixNow() + 30 * 86400,
        created_at: unixNow(),
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.subscriptions, sub.id, sub);

      return reply.code(200).send(wrapSingle('quote', updated, { subscription: sub }));
    });

    // ── Unbilled Charges ────────────────────────────────────────────────

    server.get(`${BP}/unbilled_charges`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      let charges = store.list<Record<string, unknown>>(NS.unbilledCharges);
      if (query['subscription_id[is]']) charges = charges.filter((c) => c.subscription_id === query['subscription_id[is]']);
      return reply.code(200).send(wrapList('unbilled_charge', charges));
    });

    server.post(`${BP}/unbilled_charges/invoice_unbilled_charges`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const subscriptionId = body.subscription_id as string;
      const charges = store.filter<Record<string, unknown>>(
        NS.unbilledCharges,
        (c) => c.subscription_id === subscriptionId,
      );

      // Clear the unbilled charges
      for (const charge of charges) {
        store.delete(NS.unbilledCharges, charge.id as string);
      }

      // Create invoice
      const total = charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
      const inv = {
        id: cbId('inv'),
        subscription_id: subscriptionId,
        customer_id: body.customer_id ?? null,
        status: 'payment_due',
        total,
        amount_due: total,
        amount_paid: 0,
        currency_code: 'USD',
        date: unixNow(),
        created_at: unixNow(),
        updated_at: unixNow(),
        resource_version: resourceVersion(),
      };
      store.set(NS.invoices, inv.id, inv);
      return reply.code(200).send(wrapSingle('invoice', inv));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Subscriptions
      { method: 'POST', path: `${BP}/subscriptions`, description: 'Create subscription' },
      { method: 'GET', path: `${BP}/subscriptions/:id`, description: 'Get subscription' },
      { method: 'GET', path: `${BP}/subscriptions`, description: 'List subscriptions' },
      { method: 'POST', path: `${BP}/subscriptions/:id/cancel`, description: 'Cancel subscription' },
      { method: 'POST', path: `${BP}/subscriptions/:id/reactivate`, description: 'Reactivate subscription' },
      { method: 'POST', path: `${BP}/subscriptions/:id/pause`, description: 'Pause subscription' },
      { method: 'POST', path: `${BP}/subscriptions/:id/resume`, description: 'Resume subscription' },
      { method: 'POST', path: `${BP}/subscriptions/:id/change_term_end`, description: 'Change subscription term end' },
      { method: 'POST', path: `${BP}/subscriptions/:id/update`, description: 'Update subscription' },

      // Customers
      { method: 'POST', path: `${BP}/customers`, description: 'Create customer' },
      { method: 'GET', path: `${BP}/customers/:id`, description: 'Get customer' },
      { method: 'GET', path: `${BP}/customers`, description: 'List customers' },
      { method: 'POST', path: `${BP}/customers/:id`, description: 'Update customer' },

      // Items
      { method: 'POST', path: `${BP}/items`, description: 'Create item' },
      { method: 'GET', path: `${BP}/items/:id`, description: 'Get item' },
      { method: 'GET', path: `${BP}/items`, description: 'List items' },

      // Item Prices
      { method: 'POST', path: `${BP}/item_prices`, description: 'Create item price' },
      { method: 'GET', path: `${BP}/item_prices/:id`, description: 'Get item price' },
      { method: 'GET', path: `${BP}/item_prices`, description: 'List item prices' },

      // Item Families
      { method: 'POST', path: `${BP}/item_families`, description: 'Create item family' },
      { method: 'GET', path: `${BP}/item_families/:id`, description: 'Get item family' },
      { method: 'GET', path: `${BP}/item_families`, description: 'List item families' },

      // Invoices
      { method: 'GET', path: `${BP}/invoices/:id`, description: 'Get invoice' },
      { method: 'GET', path: `${BP}/invoices`, description: 'List invoices' },
      { method: 'POST', path: `${BP}/invoices/:id/collect_payment`, description: 'Collect invoice payment' },
      { method: 'POST', path: `${BP}/invoices/:id/void`, description: 'Void invoice' },
      { method: 'POST', path: `${BP}/invoices/:id/write_off`, description: 'Write off invoice' },
      { method: 'GET', path: `${BP}/invoices/:id/pdf`, description: 'Get invoice PDF' },

      // Credit Notes
      { method: 'POST', path: `${BP}/credit_notes`, description: 'Create credit note' },
      { method: 'GET', path: `${BP}/credit_notes/:id`, description: 'Get credit note' },
      { method: 'GET', path: `${BP}/credit_notes`, description: 'List credit notes' },

      // Coupons
      { method: 'POST', path: `${BP}/coupons`, description: 'Create coupon' },
      { method: 'GET', path: `${BP}/coupons/:id`, description: 'Get coupon' },
      { method: 'GET', path: `${BP}/coupons`, description: 'List coupons' },
      { method: 'POST', path: `${BP}/coupons/:id`, description: 'Update coupon' },
      { method: 'DELETE', path: `${BP}/coupons/:id/delete`, description: 'Delete coupon' },

      // Usage
      { method: 'POST', path: `${BP}/subscriptions/:id/usages`, description: 'Create usage record' },
      { method: 'GET', path: `${BP}/subscriptions/:id/usages`, description: 'List usage records' },
      { method: 'DELETE', path: `${BP}/usages/:id`, description: 'Delete usage record' },

      // Payment Sources
      { method: 'POST', path: `${BP}/payment_sources`, description: 'Create payment source' },
      { method: 'GET', path: `${BP}/payment_sources`, description: 'List payment sources' },
      { method: 'DELETE', path: `${BP}/payment_sources/:id/delete`, description: 'Delete payment source' },

      // Transactions
      { method: 'GET', path: `${BP}/transactions/:id`, description: 'Get transaction' },
      { method: 'GET', path: `${BP}/transactions`, description: 'List transactions' },

      // Events
      { method: 'GET', path: `${BP}/events/:id`, description: 'Get event' },
      { method: 'GET', path: `${BP}/events`, description: 'List events' },

      // Hosted Pages
      { method: 'POST', path: `${BP}/hosted_pages/checkout_new`, description: 'Create checkout hosted page' },
      { method: 'POST', path: `${BP}/hosted_pages/manage_payment_sources`, description: 'Create manage payment sources page' },

      // Portal Sessions
      { method: 'POST', path: `${BP}/portal_sessions`, description: 'Create portal session' },

      // Quotes
      { method: 'POST', path: `${BP}/quotes`, description: 'Create quote' },
      { method: 'GET', path: `${BP}/quotes/:id`, description: 'Get quote' },
      { method: 'GET', path: `${BP}/quotes`, description: 'List quotes' },
      { method: 'POST', path: `${BP}/quotes/:id/convert`, description: 'Convert quote to subscription' },

      // Unbilled Charges
      { method: 'GET', path: `${BP}/unbilled_charges`, description: 'List unbilled charges' },
      { method: 'POST', path: `${BP}/unbilled_charges/invoice_unbilled_charges`, description: 'Invoice unbilled charges' },
    ];
  }

  // ── Cross-surface seeding ────────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    subscriptions: NS.subscriptions,
    customers: NS.customers,
    items: NS.items,
    item_prices: NS.itemPrices,
    item_families: NS.itemFamilies,
    invoices: NS.invoices,
    credit_notes: NS.creditNotes,
    coupons: NS.coupons,
    payment_sources: NS.paymentSources,
    transactions: NS.transactions,
    events: NS.events,
    quotes: NS.quotes,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const cbData = expanded.apiResponses?.chargebee;
      if (!cbData) continue;

      for (const [resourceType, responses] of Object.entries(cbData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          if (!body.id) continue;

          const enriched = {
            created_at: body.created_at ?? unixNow(),
            updated_at: body.updated_at ?? unixNow(),
            resource_version: body.resource_version ?? resourceVersion(),
            ...body,
          };

          store.set(namespace, String(body.id), enriched);
        }
      }
    }
  }
}
