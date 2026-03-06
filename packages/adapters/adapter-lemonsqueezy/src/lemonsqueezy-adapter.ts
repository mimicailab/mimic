import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { LemonSqueezyConfig } from './config.js';
import { notFound } from './lemonsqueezy-errors.js';
import { registerLemonSqueezyTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  stores: 'ls_stores',
  products: 'ls_products',
  variants: 'ls_variants',
  prices: 'ls_prices',
  customers: 'ls_customers',
  orders: 'ls_orders',
  orderItems: 'ls_order_items',
  subscriptions: 'ls_subscriptions',
  subscriptionItems: 'ls_subscription_items',
  subscriptionInvoices: 'ls_subscription_invoices',
  usageRecords: 'ls_usage_records',
  discounts: 'ls_discounts',
  discountRedemptions: 'ls_discount_redemptions',
  licenseKeys: 'ls_license_keys',
  licenseKeyInstances: 'ls_license_key_instances',
  checkouts: 'ls_checkouts',
  webhooks: 'ls_webhooks',
  files: 'ls_files',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 1000;
function numericId(): string {
  return String(++_seq);
}

function isoNow(): string {
  return new Date().toISOString();
}

/** JSON:API single resource wrapper */
function jsonApiSingle(type: string, id: string, attributes: Record<string, unknown>, relationships?: Record<string, unknown>) {
  return {
    jsonapi: { version: '1.0' },
    links: { self: `https://api.lemonsqueezy.com/v1/${type}/${id}` },
    data: {
      type,
      id,
      attributes,
      relationships: relationships ?? {},
      links: { self: `https://api.lemonsqueezy.com/v1/${type}/${id}` },
    },
  };
}

/** Strip internal fields from a stored record and return attributes */
function extractAttrs(obj: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, _type, _relationships, ...attrs } = obj;
  return attrs;
}

/** JSON:API list wrapper */
function jsonApiList(type: string, items: Record<string, unknown>[]) {
  return {
    jsonapi: { version: '1.0' },
    meta: { page: { currentPage: 1, from: 1, lastPage: 1, perPage: 10, to: items.length, total: items.length } },
    links: { first: `https://api.lemonsqueezy.com/v1/${type}?page=1`, last: `https://api.lemonsqueezy.com/v1/${type}?page=1` },
    data: items.map((item) => {
      const { id, _type, _relationships, ...attrs } = item as Record<string, unknown>;
      return {
        type: (_type as string) ?? type,
        id: String(id),
        attributes: attrs,
        relationships: (_relationships as Record<string, unknown>) ?? {},
        links: { self: `https://api.lemonsqueezy.com/v1/${type}/${id}` },
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Lemon Squeezy Adapter
// ---------------------------------------------------------------------------

export class LemonSqueezyAdapter extends BaseApiMockAdapter<LemonSqueezyConfig> {
  readonly id = 'lemonsqueezy';
  readonly name = 'Lemon Squeezy API';
  readonly basePath = '/lemonsqueezy/v1';
  readonly versions = ['1'];

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerLemonSqueezyTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+test_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    this.seedFromApiResponses(data, store);

    // ── Users ────────────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/users/me', async (_req, reply) => {
      const user = {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        color: '#7c3aed',
        avatar_url: null,
        has_custom_avatar: false,
        createdAt: isoNow(),
        updatedAt: isoNow(),
      };
      return reply.code(200).send(jsonApiSingle('users', '1', user));
    });

    // ── Stores ───────────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/stores', async (_req, reply) => {
      let stores = store.list<Record<string, unknown>>(NS.stores);
      if (stores.length === 0) {
        const defaultStore = {
          id: '1',
          _type: 'stores',
          name: 'Test Store',
          slug: 'test-store',
          domain: 'test-store.lemonsqueezy.com',
          url: 'https://test-store.lemonsqueezy.com',
          avatar_url: null,
          plan: 'fresh',
          country: 'US',
          country_nicename: 'United States',
          currency: 'USD',
          total_sales: 0,
          total_revenue: 0,
          thirty_day_sales: 0,
          thirty_day_revenue: 0,
          created_at: isoNow(),
          updated_at: isoNow(),
        };
        stores = [defaultStore];
      }
      return reply.code(200).send(jsonApiList('stores', stores));
    });

    server.get('/lemonsqueezy/v1/stores/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const s = store.get<Record<string, unknown>>(NS.stores, id);
      if (!s) return reply.code(404).send(notFound('Store', id));
      const attrs = extractAttrs(s);
      return reply.code(200).send(jsonApiSingle('stores', id, attrs));
    });

    // ── Products ─────────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/products', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let products = store.list<Record<string, unknown>>(NS.products);
      if (query['filter[store_id]']) products = products.filter((p) => String(p.store_id) === query['filter[store_id]']);
      return reply.code(200).send(jsonApiList('products', products));
    });

    server.get('/lemonsqueezy/v1/products/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const product = store.get<Record<string, unknown>>(NS.products, id);
      if (!product) return reply.code(404).send(notFound('Product', id));
      const attrs = extractAttrs(product);
      return reply.code(200).send(jsonApiSingle('products', id, attrs));
    });

    // ── Variants ─────────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/variants', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let variants = store.list<Record<string, unknown>>(NS.variants);
      if (query['filter[product_id]']) variants = variants.filter((v) => String(v.product_id) === query['filter[product_id]']);
      return reply.code(200).send(jsonApiList('variants', variants));
    });

    server.get('/lemonsqueezy/v1/variants/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const variant = store.get<Record<string, unknown>>(NS.variants, id);
      if (!variant) return reply.code(404).send(notFound('Variant', id));
      const attrs = extractAttrs(variant);
      return reply.code(200).send(jsonApiSingle('variants', id, attrs));
    });

    // ── Prices ───────────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/prices', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let prices = store.list<Record<string, unknown>>(NS.prices);
      if (query['filter[variant_id]']) prices = prices.filter((p) => String(p.variant_id) === query['filter[variant_id]']);
      return reply.code(200).send(jsonApiList('prices', prices));
    });

    server.get('/lemonsqueezy/v1/prices/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const price = store.get<Record<string, unknown>>(NS.prices, id);
      if (!price) return reply.code(404).send(notFound('Price', id));
      const attrs = extractAttrs(price);
      return reply.code(200).send(jsonApiSingle('prices', id, attrs));
    });

    // ── Customers ────────────────────────────────────────────────────────

    server.post('/lemonsqueezy/v1/customers', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      const id = numericId();
      const customer = {
        id,
        _type: 'customers',
        name: attrs.name ?? null,
        email: attrs.email ?? null,
        status: 'subscribed',
        city: attrs.city ?? null,
        region: attrs.region ?? null,
        country: attrs.country ?? 'US',
        store_id: attrs.store_id ?? 1,
        total_revenue_currency: 0,
        mrr: 0,
        status_formatted: 'Subscribed',
        country_formatted: 'United States',
        created_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.customers, id, customer);
      const cAttrs = extractAttrs(customer);
      return reply.code(201).send(jsonApiSingle('customers', id, cAttrs));
    });

    server.get('/lemonsqueezy/v1/customers', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let customers = store.list<Record<string, unknown>>(NS.customers);
      if (query['filter[store_id]']) customers = customers.filter((c) => String(c.store_id) === query['filter[store_id]']);
      if (query['filter[email]']) customers = customers.filter((c) => c.email === query['filter[email]']);
      return reply.code(200).send(jsonApiList('customers', customers));
    });

    server.get('/lemonsqueezy/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get<Record<string, unknown>>(NS.customers, id);
      if (!customer) return reply.code(404).send(notFound('Customer', id));
      const attrs = extractAttrs(customer);
      return reply.code(200).send(jsonApiSingle('customers', id, attrs));
    });

    server.patch('/lemonsqueezy/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.customers, id);
      if (!existing) return reply.code(404).send(notFound('Customer', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      const updated = { ...existing, ...attrs, updated_at: isoNow() };
      store.set(NS.customers, id, updated);
      const uAttrs = extractAttrs(updated);
      return reply.code(200).send(jsonApiSingle('customers', id, uAttrs));
    });

    // ── Orders ───────────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/orders', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let orders = store.list<Record<string, unknown>>(NS.orders);
      if (query['filter[store_id]']) orders = orders.filter((o) => String(o.store_id) === query['filter[store_id]']);
      if (query['filter[user_email]']) orders = orders.filter((o) => o.user_email === query['filter[user_email]']);
      return reply.code(200).send(jsonApiList('orders', orders));
    });

    server.get('/lemonsqueezy/v1/orders/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, id);
      if (!order) return reply.code(404).send(notFound('Order', id));
      const attrs = extractAttrs(order);
      return reply.code(200).send(jsonApiSingle('orders', id, attrs));
    });

    // ── Order Items ──────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/order-items', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let items = store.list<Record<string, unknown>>(NS.orderItems);
      if (query['filter[order_id]']) items = items.filter((i) => String(i.order_id) === query['filter[order_id]']);
      return reply.code(200).send(jsonApiList('order-items', items));
    });

    server.get('/lemonsqueezy/v1/order-items/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const item = store.get<Record<string, unknown>>(NS.orderItems, id);
      if (!item) return reply.code(404).send(notFound('Order item', id));
      const attrs = extractAttrs(item);
      return reply.code(200).send(jsonApiSingle('order-items', id, attrs));
    });

    // ── Subscriptions ────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/subscriptions', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let subs = store.list<Record<string, unknown>>(NS.subscriptions);
      if (query['filter[store_id]']) subs = subs.filter((s) => String(s.store_id) === query['filter[store_id]']);
      if (query['filter[status]']) subs = subs.filter((s) => s.status === query['filter[status]']);
      return reply.code(200).send(jsonApiList('subscriptions', subs));
    });

    server.get('/lemonsqueezy/v1/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!sub) return reply.code(404).send(notFound('Subscription', id));
      const attrs = extractAttrs(sub);
      return reply.code(200).send(jsonApiSingle('subscriptions', id, attrs));
    });

    server.patch('/lemonsqueezy/v1/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      if (attrs.cancelled === true) {
        attrs.status = 'cancelled';
        attrs.ends_at = attrs.ends_at ?? isoNow();
      }
      if (attrs.pause !== undefined) {
        attrs.status = attrs.pause ? 'paused' : 'active';
      }
      const updated = { ...existing, ...attrs, updated_at: isoNow() };
      store.set(NS.subscriptions, id, updated);
      const uAttrs = extractAttrs(updated);
      return reply.code(200).send(jsonApiSingle('subscriptions', id, uAttrs));
    });

    // ── Subscription Items ───────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/subscription-items', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let items = store.list<Record<string, unknown>>(NS.subscriptionItems);
      if (query['filter[subscription_id]']) items = items.filter((i) => String(i.subscription_id) === query['filter[subscription_id]']);
      return reply.code(200).send(jsonApiList('subscription-items', items));
    });

    server.get('/lemonsqueezy/v1/subscription-items/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const item = store.get<Record<string, unknown>>(NS.subscriptionItems, id);
      if (!item) return reply.code(404).send(notFound('Subscription item', id));
      const attrs = extractAttrs(item);
      return reply.code(200).send(jsonApiSingle('subscription-items', id, attrs));
    });

    server.patch('/lemonsqueezy/v1/subscription-items/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptionItems, id);
      if (!existing) return reply.code(404).send(notFound('Subscription item', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      const updated = { ...existing, ...attrs, updated_at: isoNow() };
      store.set(NS.subscriptionItems, id, updated);
      const uAttrs = extractAttrs(updated);
      return reply.code(200).send(jsonApiSingle('subscription-items', id, uAttrs));
    });

    server.get('/lemonsqueezy/v1/subscription-items/:id/current-usage', async (req, reply) => {
      const { id } = req.params as { id: string };
      const item = store.get<Record<string, unknown>>(NS.subscriptionItems, id);
      if (!item) return reply.code(404).send(notFound('Subscription item', id));
      return reply.code(200).send({
        jsonapi: { version: '1.0' },
        meta: {
          period_start: isoNow(),
          period_end: isoNow(),
          quantity: 0,
          interval_unit: 'month',
          interval_quantity: 1,
        },
      });
    });

    // ── Subscription Invoices ────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/subscription-invoices', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let invoices = store.list<Record<string, unknown>>(NS.subscriptionInvoices);
      if (query['filter[subscription_id]']) invoices = invoices.filter((i) => String(i.subscription_id) === query['filter[subscription_id]']);
      return reply.code(200).send(jsonApiList('subscription-invoices', invoices));
    });

    server.get('/lemonsqueezy/v1/subscription-invoices/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get<Record<string, unknown>>(NS.subscriptionInvoices, id);
      if (!invoice) return reply.code(404).send(notFound('Subscription invoice', id));
      const attrs = extractAttrs(invoice);
      return reply.code(200).send(jsonApiSingle('subscription-invoices', id, attrs));
    });

    // ── Usage Records ────────────────────────────────────────────────────

    server.post('/lemonsqueezy/v1/usage-records', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      const id = numericId();
      const record = {
        id,
        _type: 'usage-records',
        subscription_item_id: attrs.subscription_item_id ?? null,
        quantity: attrs.quantity ?? 0,
        action: attrs.action ?? 'increment',
        created_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.usageRecords, id, record);
      const rAttrs = extractAttrs(record);
      return reply.code(201).send(jsonApiSingle('usage-records', id, rAttrs));
    });

    server.get('/lemonsqueezy/v1/usage-records', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let records = store.list<Record<string, unknown>>(NS.usageRecords);
      if (query['filter[subscription_item_id]']) records = records.filter((r) => String(r.subscription_item_id) === query['filter[subscription_item_id]']);
      return reply.code(200).send(jsonApiList('usage-records', records));
    });

    server.get('/lemonsqueezy/v1/usage-records/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const record = store.get<Record<string, unknown>>(NS.usageRecords, id);
      if (!record) return reply.code(404).send(notFound('Usage record', id));
      const attrs = extractAttrs(record);
      return reply.code(200).send(jsonApiSingle('usage-records', id, attrs));
    });

    // ── Discounts ────────────────────────────────────────────────────────

    server.post('/lemonsqueezy/v1/discounts', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      const id = numericId();
      const discount = {
        id,
        _type: 'discounts',
        store_id: attrs.store_id ?? 1,
        name: attrs.name ?? 'Discount',
        code: attrs.code ?? `DISC${id}`,
        amount: attrs.amount ?? 0,
        amount_type: attrs.amount_type ?? 'percent',
        is_limited_to_products: attrs.is_limited_to_products ?? false,
        is_limited_redemptions: attrs.is_limited_redemptions ?? false,
        max_redemptions: attrs.max_redemptions ?? 0,
        starts_at: attrs.starts_at ?? null,
        expires_at: attrs.expires_at ?? null,
        duration: attrs.duration ?? 'once',
        status: 'published',
        status_formatted: 'Published',
        created_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.discounts, id, discount);
      const dAttrs = extractAttrs(discount);
      return reply.code(201).send(jsonApiSingle('discounts', id, dAttrs));
    });

    server.get('/lemonsqueezy/v1/discounts', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let discounts = store.list<Record<string, unknown>>(NS.discounts);
      if (query['filter[store_id]']) discounts = discounts.filter((d) => String(d.store_id) === query['filter[store_id]']);
      return reply.code(200).send(jsonApiList('discounts', discounts));
    });

    server.get('/lemonsqueezy/v1/discounts/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const discount = store.get<Record<string, unknown>>(NS.discounts, id);
      if (!discount) return reply.code(404).send(notFound('Discount', id));
      const attrs = extractAttrs(discount);
      return reply.code(200).send(jsonApiSingle('discounts', id, attrs));
    });

    server.delete('/lemonsqueezy/v1/discounts/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.discounts, id);
      if (!existing) return reply.code(404).send(notFound('Discount', id));
      store.delete(NS.discounts, id);
      return reply.code(204).send();
    });

    // ── Discount Redemptions ─────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/discount-redemptions', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let redemptions = store.list<Record<string, unknown>>(NS.discountRedemptions);
      if (query['filter[discount_id]']) redemptions = redemptions.filter((r) => String(r.discount_id) === query['filter[discount_id]']);
      return reply.code(200).send(jsonApiList('discount-redemptions', redemptions));
    });

    server.get('/lemonsqueezy/v1/discount-redemptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const redemption = store.get<Record<string, unknown>>(NS.discountRedemptions, id);
      if (!redemption) return reply.code(404).send(notFound('Discount redemption', id));
      const attrs = extractAttrs(redemption);
      return reply.code(200).send(jsonApiSingle('discount-redemptions', id, attrs));
    });

    // ── License Keys ─────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/license-keys', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let keys = store.list<Record<string, unknown>>(NS.licenseKeys);
      if (query['filter[store_id]']) keys = keys.filter((k) => String(k.store_id) === query['filter[store_id]']);
      if (query['filter[order_id]']) keys = keys.filter((k) => String(k.order_id) === query['filter[order_id]']);
      return reply.code(200).send(jsonApiList('license-keys', keys));
    });

    server.get('/lemonsqueezy/v1/license-keys/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const key = store.get<Record<string, unknown>>(NS.licenseKeys, id);
      if (!key) return reply.code(404).send(notFound('License key', id));
      const attrs = extractAttrs(key);
      return reply.code(200).send(jsonApiSingle('license-keys', id, attrs));
    });

    server.patch('/lemonsqueezy/v1/license-keys/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.licenseKeys, id);
      if (!existing) return reply.code(404).send(notFound('License key', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      const updated = { ...existing, ...attrs, updated_at: isoNow() };
      store.set(NS.licenseKeys, id, updated);
      const uAttrs = extractAttrs(updated);
      return reply.code(200).send(jsonApiSingle('license-keys', id, uAttrs));
    });

    // ── License Key Instances ────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/license-key-instances', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let instances = store.list<Record<string, unknown>>(NS.licenseKeyInstances);
      if (query['filter[license_key_id]']) instances = instances.filter((i) => String(i.license_key_id) === query['filter[license_key_id]']);
      return reply.code(200).send(jsonApiList('license-key-instances', instances));
    });

    server.get('/lemonsqueezy/v1/license-key-instances/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const instance = store.get<Record<string, unknown>>(NS.licenseKeyInstances, id);
      if (!instance) return reply.code(404).send(notFound('License key instance', id));
      const attrs = extractAttrs(instance);
      return reply.code(200).send(jsonApiSingle('license-key-instances', id, attrs));
    });

    // ── Checkouts ────────────────────────────────────────────────────────

    server.post('/lemonsqueezy/v1/checkouts', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      const relationships = (data.relationships ?? {}) as Record<string, unknown>;
      const id = numericId();
      const storeRel = relationships.store as Record<string, unknown> | undefined;
      const variantRel = relationships.variant as Record<string, unknown> | undefined;
      const checkout = {
        id,
        _type: 'checkouts',
        store_id: (storeRel?.data as Record<string, unknown>)?.id ?? attrs.store_id ?? 1,
        variant_id: (variantRel?.data as Record<string, unknown>)?.id ?? attrs.variant_id ?? 1,
        custom_price: attrs.custom_price ?? null,
        product_options: attrs.product_options ?? {},
        checkout_options: attrs.checkout_options ?? {},
        checkout_data: attrs.checkout_data ?? {},
        expires_at: attrs.expires_at ?? new Date(Date.now() + 3600000).toISOString(),
        url: `https://test-store.lemonsqueezy.com/checkout/buy/${generateId('', 32)}`,
        created_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.checkouts, id, checkout);
      const cAttrs = extractAttrs(checkout);
      return reply.code(201).send(jsonApiSingle('checkouts', id, cAttrs));
    });

    server.get('/lemonsqueezy/v1/checkouts', async (_req, reply) => {
      const checkouts = store.list<Record<string, unknown>>(NS.checkouts);
      return reply.code(200).send(jsonApiList('checkouts', checkouts));
    });

    server.get('/lemonsqueezy/v1/checkouts/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const checkout = store.get<Record<string, unknown>>(NS.checkouts, id);
      if (!checkout) return reply.code(404).send(notFound('Checkout', id));
      const attrs = extractAttrs(checkout);
      return reply.code(200).send(jsonApiSingle('checkouts', id, attrs));
    });

    // ── Webhooks ─────────────────────────────────────────────────────────

    server.post('/lemonsqueezy/v1/webhooks', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      const id = numericId();
      const webhook = {
        id,
        _type: 'webhooks',
        store_id: attrs.store_id ?? 1,
        url: attrs.url ?? '',
        events: attrs.events ?? [],
        secret: attrs.secret ?? generateId('whsec_', 24),
        test_mode: true,
        last_sent_at: null,
        created_at: isoNow(),
        updated_at: isoNow(),
      };
      store.set(NS.webhooks, id, webhook);
      const wAttrs = extractAttrs(webhook);
      return reply.code(201).send(jsonApiSingle('webhooks', id, wAttrs));
    });

    server.get('/lemonsqueezy/v1/webhooks', async (_req, reply) => {
      const webhooks = store.list<Record<string, unknown>>(NS.webhooks);
      return reply.code(200).send(jsonApiList('webhooks', webhooks));
    });

    server.get('/lemonsqueezy/v1/webhooks/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const webhook = store.get<Record<string, unknown>>(NS.webhooks, id);
      if (!webhook) return reply.code(404).send(notFound('Webhook', id));
      const attrs = extractAttrs(webhook);
      return reply.code(200).send(jsonApiSingle('webhooks', id, attrs));
    });

    server.patch('/lemonsqueezy/v1/webhooks/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.webhooks, id);
      if (!existing) return reply.code(404).send(notFound('Webhook', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = (body.data ?? body) as Record<string, unknown>;
      const attrs = (data.attributes ?? data) as Record<string, unknown>;
      const updated = { ...existing, ...attrs, updated_at: isoNow() };
      store.set(NS.webhooks, id, updated);
      const uAttrs = extractAttrs(updated);
      return reply.code(200).send(jsonApiSingle('webhooks', id, uAttrs));
    });

    server.delete('/lemonsqueezy/v1/webhooks/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.webhooks, id);
      if (!existing) return reply.code(404).send(notFound('Webhook', id));
      store.delete(NS.webhooks, id);
      return reply.code(204).send();
    });

    // ── Files ────────────────────────────────────────────────────────────

    server.get('/lemonsqueezy/v1/files', async (req, reply) => {
      const query = req.query as Record<string, string>;
      let files = store.list<Record<string, unknown>>(NS.files);
      if (query['filter[variant_id]']) files = files.filter((f) => String(f.variant_id) === query['filter[variant_id]']);
      return reply.code(200).send(jsonApiList('files', files));
    });

    server.get('/lemonsqueezy/v1/files/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const file = store.get<Record<string, unknown>>(NS.files, id);
      if (!file) return reply.code(404).send(notFound('File', id));
      const attrs = extractAttrs(file);
      return reply.code(200).send(jsonApiSingle('files', id, attrs));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Users
      { method: 'GET', path: '/lemonsqueezy/v1/users/me', description: 'Get authenticated user' },

      // Stores
      { method: 'GET', path: '/lemonsqueezy/v1/stores', description: 'List stores' },
      { method: 'GET', path: '/lemonsqueezy/v1/stores/:id', description: 'Get store' },

      // Products
      { method: 'GET', path: '/lemonsqueezy/v1/products', description: 'List products' },
      { method: 'GET', path: '/lemonsqueezy/v1/products/:id', description: 'Get product' },

      // Variants
      { method: 'GET', path: '/lemonsqueezy/v1/variants', description: 'List variants' },
      { method: 'GET', path: '/lemonsqueezy/v1/variants/:id', description: 'Get variant' },

      // Prices
      { method: 'GET', path: '/lemonsqueezy/v1/prices', description: 'List prices' },
      { method: 'GET', path: '/lemonsqueezy/v1/prices/:id', description: 'Get price' },

      // Customers
      { method: 'POST', path: '/lemonsqueezy/v1/customers', description: 'Create customer' },
      { method: 'GET', path: '/lemonsqueezy/v1/customers', description: 'List customers' },
      { method: 'GET', path: '/lemonsqueezy/v1/customers/:id', description: 'Get customer' },
      { method: 'PATCH', path: '/lemonsqueezy/v1/customers/:id', description: 'Update customer' },

      // Orders
      { method: 'GET', path: '/lemonsqueezy/v1/orders', description: 'List orders' },
      { method: 'GET', path: '/lemonsqueezy/v1/orders/:id', description: 'Get order' },

      // Order Items
      { method: 'GET', path: '/lemonsqueezy/v1/order-items', description: 'List order items' },
      { method: 'GET', path: '/lemonsqueezy/v1/order-items/:id', description: 'Get order item' },

      // Subscriptions
      { method: 'GET', path: '/lemonsqueezy/v1/subscriptions', description: 'List subscriptions' },
      { method: 'GET', path: '/lemonsqueezy/v1/subscriptions/:id', description: 'Get subscription' },
      { method: 'PATCH', path: '/lemonsqueezy/v1/subscriptions/:id', description: 'Update subscription' },

      // Subscription Items
      { method: 'GET', path: '/lemonsqueezy/v1/subscription-items', description: 'List subscription items' },
      { method: 'GET', path: '/lemonsqueezy/v1/subscription-items/:id', description: 'Get subscription item' },
      { method: 'PATCH', path: '/lemonsqueezy/v1/subscription-items/:id', description: 'Update subscription item' },
      { method: 'GET', path: '/lemonsqueezy/v1/subscription-items/:id/current-usage', description: 'Get subscription item usage' },

      // Subscription Invoices
      { method: 'GET', path: '/lemonsqueezy/v1/subscription-invoices', description: 'List subscription invoices' },
      { method: 'GET', path: '/lemonsqueezy/v1/subscription-invoices/:id', description: 'Get subscription invoice' },

      // Usage Records
      { method: 'POST', path: '/lemonsqueezy/v1/usage-records', description: 'Create usage record' },
      { method: 'GET', path: '/lemonsqueezy/v1/usage-records', description: 'List usage records' },
      { method: 'GET', path: '/lemonsqueezy/v1/usage-records/:id', description: 'Get usage record' },

      // Discounts
      { method: 'POST', path: '/lemonsqueezy/v1/discounts', description: 'Create discount' },
      { method: 'GET', path: '/lemonsqueezy/v1/discounts', description: 'List discounts' },
      { method: 'GET', path: '/lemonsqueezy/v1/discounts/:id', description: 'Get discount' },
      { method: 'DELETE', path: '/lemonsqueezy/v1/discounts/:id', description: 'Delete discount' },

      // Discount Redemptions
      { method: 'GET', path: '/lemonsqueezy/v1/discount-redemptions', description: 'List discount redemptions' },
      { method: 'GET', path: '/lemonsqueezy/v1/discount-redemptions/:id', description: 'Get discount redemption' },

      // License Keys
      { method: 'GET', path: '/lemonsqueezy/v1/license-keys', description: 'List license keys' },
      { method: 'GET', path: '/lemonsqueezy/v1/license-keys/:id', description: 'Get license key' },
      { method: 'PATCH', path: '/lemonsqueezy/v1/license-keys/:id', description: 'Update license key' },

      // License Key Instances
      { method: 'GET', path: '/lemonsqueezy/v1/license-key-instances', description: 'List license key instances' },
      { method: 'GET', path: '/lemonsqueezy/v1/license-key-instances/:id', description: 'Get license key instance' },

      // Checkouts
      { method: 'POST', path: '/lemonsqueezy/v1/checkouts', description: 'Create checkout' },
      { method: 'GET', path: '/lemonsqueezy/v1/checkouts', description: 'List checkouts' },
      { method: 'GET', path: '/lemonsqueezy/v1/checkouts/:id', description: 'Get checkout' },

      // Webhooks
      { method: 'POST', path: '/lemonsqueezy/v1/webhooks', description: 'Create webhook' },
      { method: 'GET', path: '/lemonsqueezy/v1/webhooks', description: 'List webhooks' },
      { method: 'GET', path: '/lemonsqueezy/v1/webhooks/:id', description: 'Get webhook' },
      { method: 'PATCH', path: '/lemonsqueezy/v1/webhooks/:id', description: 'Update webhook' },
      { method: 'DELETE', path: '/lemonsqueezy/v1/webhooks/:id', description: 'Delete webhook' },

      // Files
      { method: 'GET', path: '/lemonsqueezy/v1/files', description: 'List files' },
      { method: 'GET', path: '/lemonsqueezy/v1/files/:id', description: 'Get file' },
    ];
  }

  // ── Cross-surface seeding ────────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    stores: NS.stores,
    products: NS.products,
    variants: NS.variants,
    prices: NS.prices,
    customers: NS.customers,
    orders: NS.orders,
    order_items: NS.orderItems,
    subscriptions: NS.subscriptions,
    subscription_items: NS.subscriptionItems,
    subscription_invoices: NS.subscriptionInvoices,
    discounts: NS.discounts,
    license_keys: NS.licenseKeys,
    license_key_instances: NS.licenseKeyInstances,
    checkouts: NS.checkouts,
    webhooks: NS.webhooks,
    files: NS.files,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const lsData = expanded.apiResponses?.lemonsqueezy;
      if (!lsData) continue;

      for (const [resourceType, responses] of Object.entries(lsData.responses)) {
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
