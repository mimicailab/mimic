import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { SquareConfig } from './config.js';
import { sqError } from './square-errors.js';
import { generateUUID, generateShortCode, generateGAN } from './helpers.js';
import { registerSquareTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  payments: 'sq_payments',
  refunds: 'sq_refunds',
  orders: 'sq_orders',
  catalog: 'sq_catalog',
  inventory: 'sq_inventory',
  customers: 'sq_customers',
  locations: 'sq_locations',
  subscriptions: 'sq_subscriptions',
  invoices: 'sq_invoices',
  deviceCodes: 'sq_device_codes',
  giftCards: 'sq_gift_cards',
  giftCardActivities: 'sq_gift_card_activities',
  bookings: 'sq_bookings',
  loyaltyAccounts: 'sq_loyalty_accounts',
  loyaltyPrograms: 'sq_loyalty_programs',
  disputes: 'sq_disputes',
  cards: 'sq_cards',
  teamMembers: 'sq_team_members',
  idempotency: 'sq_idempotency',
} as const;

// ---------------------------------------------------------------------------
// Square Adapter
// ---------------------------------------------------------------------------

export class SquareAdapter extends BaseApiMockAdapter<SquareConfig> {
  readonly id = 'square';
  readonly name = 'Square API';
  readonly basePath = '/square/v2';
  readonly versions = ['2025-10-16'];
  readonly promptContext = {
    resources: ['customers', 'payments', 'orders', 'invoices', 'subscriptions', 'catalog_objects', 'refunds'],
    amountFormat: 'integer cents in Money object (e.g. { amount: 2999, currency: "USD" })',
    relationships: [
      'payment → customer, order',
      'order → customer, location',
      'invoice → customer, order',
      'subscription → customer, plan',
      'refund → payment',
    ],
    requiredFields: {
      customers: ['id', 'given_name', 'family_name', 'email_address', 'created_at'],
      payments: ['id', 'amount_money', 'status', 'source_type', 'location_id', 'created_at'],
      orders: ['id', 'location_id', 'line_items', 'state', 'total_money', 'created_at'],
      invoices: ['id', 'order_id', 'status', 'payment_requests', 'created_at'],
      subscriptions: ['id', 'customer_id', 'plan_variation_id', 'status', 'start_date', 'created_at'],
    },
    notes: 'Amounts use Money object {amount (cents), currency}. Timestamps ISO 8601. Payment status: COMPLETED, APPROVED, PENDING, CANCELED, FAILED. All operations are location-scoped.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    amountFields: ['amount_money', 'total_money', 'tip_money'],
    statusEnums: {
      payments: ['COMPLETED', 'APPROVED', 'PENDING', 'CANCELED', 'FAILED'],
      orders: ['OPEN', 'COMPLETED', 'CANCELED', 'DRAFT'],
      invoices: ['DRAFT', 'UNPAID', 'SCHEDULED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELED', 'FAILED', 'PAYMENT_PENDING'],
      subscriptions: ['PENDING', 'ACTIVE', 'CANCELED', 'DEACTIVATED', 'PAUSED'],
    },
    timestampFields: ['created_at', 'updated_at', 'start_date'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerSquareTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.replace('Bearer ', '').match(/^EAAA([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    this.seedFromApiResponses(data, store);
    const p = this.basePath;

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENTS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/payments`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ payment: existing });
      }
      const payment = {
        id: generateUUID(),
        status: 'COMPLETED',
        source_type: 'CARD',
        amount_money: body.amount_money || { amount: 0, currency: 'USD' },
        total_money: body.amount_money || { amount: 0, currency: 'USD' },
        tip_money: body.tip_money || { amount: 0, currency: 'USD' },
        location_id: body.location_id || generateUUID(),
        order_id: body.order_id || null,
        customer_id: body.customer_id || null,
        reference_id: body.reference_id || null,
        card_details: {
          status: 'CAPTURED',
          card: { card_brand: 'VISA', last_4: '1234', exp_month: 12, exp_year: 2027 },
          entry_method: 'KEYED',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      };
      store.set(NS.payments, payment.id, payment);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, payment);
      return reply.send({ payment });
    });

    server.get(`${p}/payments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const payment = store.get(NS.payments, id);
      if (!payment) return reply.status(404).send(sqError('NOT_FOUND', `Payment ${id} not found`));
      return reply.send({ payment });
    });

    server.get(`${p}/payments`, async (_req, reply) => {
      return reply.send({ payments: store.list(NS.payments), cursor: null });
    });

    server.post(`${p}/payments/:id/cancel`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const payment = store.get(NS.payments, id);
      if (!payment) return reply.status(404).send(sqError('NOT_FOUND', `Payment ${id} not found`));
      store.update(NS.payments, id, { status: 'CANCELED', updated_at: new Date().toISOString() });
      return reply.send({ payment: store.get(NS.payments, id) });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  REFUNDS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/refunds`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ refund: existing });
      }
      const refund = {
        id: generateUUID(),
        status: 'COMPLETED',
        payment_id: body.payment_id,
        amount_money: body.amount_money,
        reason: body.reason || null,
        location_id: body.location_id || generateUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.set(NS.refunds, refund.id, refund);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, refund);
      return reply.send({ refund });
    });

    server.get(`${p}/refunds/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const refund = store.get(NS.refunds, id);
      if (!refund) return reply.status(404).send(sqError('NOT_FOUND', `Refund ${id} not found`));
      return reply.send({ refund });
    });

    server.get(`${p}/refunds`, async (_req, reply) => {
      return reply.send({ refunds: store.list(NS.refunds), cursor: null });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  ORDERS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/orders`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ order: existing });
      }
      const orderDef = body.order || {};
      const lineItems = (orderDef.line_items || []).map((li: any) => ({
        uid: generateUUID(),
        catalog_object_id: li.catalog_object_id || null,
        name: li.name || 'Item',
        quantity: li.quantity || '1',
        base_price_money: li.base_price_money || { amount: 0, currency: 'USD' },
        total_money: li.base_price_money || { amount: 0, currency: 'USD' },
      }));
      const totalAmount = lineItems.reduce((sum: number, li: any) =>
        sum + ((li.total_money.amount || 0) * parseInt(li.quantity, 10)), 0);
      const order = {
        id: generateUUID(),
        location_id: orderDef.location_id || generateUUID(),
        state: 'OPEN',
        line_items: lineItems,
        total_money: { amount: totalAmount, currency: orderDef.line_items?.[0]?.base_price_money?.currency || 'USD' },
        total_tax_money: { amount: 0, currency: 'USD' },
        total_discount_money: { amount: 0, currency: 'USD' },
        net_amounts: {
          total_money: { amount: totalAmount, currency: 'USD' },
          tax_money: { amount: 0, currency: 'USD' },
          discount_money: { amount: 0, currency: 'USD' },
        },
        source: { name: 'Mimic' },
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.set(NS.orders, order.id, order);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, order);
      return reply.send({ order });
    });

    server.get(`${p}/orders/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = store.get(NS.orders, id);
      if (!order) return reply.status(404).send(sqError('NOT_FOUND', `Order ${id} not found`));
      return reply.send({ order });
    });

    server.post(`${p}/orders/search`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      let orders = store.list<any>(NS.orders);
      if (body.query?.filter?.state_filter?.states) {
        const states = body.query.filter.state_filter.states;
        orders = orders.filter((o: any) => states.includes(o.state));
      }
      if (body.location_ids) {
        orders = orders.filter((o: any) => body.location_ids.includes(o.location_id));
      }
      return reply.send({ orders, cursor: null });
    });

    server.post(`${p}/orders/calculate`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      const orderDef = body.order || {};
      const lineItems = (orderDef.line_items || []).map((li: any) => ({
        uid: generateUUID(),
        name: li.name || 'Item',
        quantity: li.quantity || '1',
        base_price_money: li.base_price_money || { amount: 0, currency: 'USD' },
        total_money: li.base_price_money || { amount: 0, currency: 'USD' },
      }));
      const totalAmount = lineItems.reduce((sum: number, li: any) =>
        sum + ((li.total_money.amount || 0) * parseInt(li.quantity, 10)), 0);
      return reply.send({
        order: {
          location_id: orderDef.location_id,
          line_items: lineItems,
          total_money: { amount: totalAmount, currency: 'USD' },
          total_tax_money: { amount: 0, currency: 'USD' },
          total_discount_money: { amount: 0, currency: 'USD' },
        },
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CATALOG
    // ══════════════════════════════════════════════════════════════════════

    server.get(`${p}/catalog/list`, async (req, reply) => {
      const query = req.query as any;
      let objects = store.list<any>(NS.catalog);
      if (query.types) {
        const types = query.types.split(',');
        objects = objects.filter((o: any) => types.includes(o.type));
      }
      return reply.send({ objects, cursor: null });
    });

    server.post(`${p}/catalog/object`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ catalog_object: existing });
      }
      const obj = body.object || {};
      const catalogObj = {
        id: obj.id || `#${generateUUID()}`,
        type: obj.type || 'ITEM',
        version: String(Date.now()),
        is_deleted: false,
        present_at_all_locations: true,
        updated_at: new Date().toISOString(),
        ...obj,
      };
      store.set(NS.catalog, catalogObj.id, catalogObj);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, catalogObj);
      return reply.send({ catalog_object: catalogObj, id_mappings: [] });
    });

    server.post(`${p}/catalog/search`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      let objects = store.list<any>(NS.catalog);
      if (body.object_types) {
        objects = objects.filter((o: any) => body.object_types.includes(o.type));
      }
      if (body.query?.text_query?.keywords) {
        const kw = body.query.text_query.keywords.map((k: string) => k.toLowerCase());
        objects = objects.filter((o: any) => {
          const name = (o.item_data?.name || o.name || '').toLowerCase();
          return kw.some((k: string) => name.includes(k));
        });
      }
      return reply.send({ objects, cursor: null });
    });

    server.post(`${p}/catalog/batch-upsert`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      const objects: any[] = [];
      for (const batch of (body.batches || [])) {
        for (const obj of (batch.objects || [])) {
          const catalogObj = {
            id: obj.id || `#${generateUUID()}`,
            type: obj.type || 'ITEM',
            version: String(Date.now()),
            is_deleted: false,
            updated_at: new Date().toISOString(),
            ...obj,
          };
          store.set(NS.catalog, catalogObj.id, catalogObj);
          objects.push(catalogObj);
        }
      }
      return reply.send({ objects, id_mappings: [] });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  INVENTORY
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/inventory/batch-retrieve-counts`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      const catalogObjectIds = body.catalog_object_ids || [];
      const counts = catalogObjectIds.map((coId: string) => {
        const existing = store.get<any>(NS.inventory, coId);
        return existing || {
          catalog_object_id: coId,
          catalog_object_type: 'ITEM_VARIATION',
          state: 'IN_STOCK',
          location_id: body.location_ids?.[0] || generateUUID(),
          quantity: '0',
          calculated_at: new Date().toISOString(),
        };
      });
      return reply.send({ counts, cursor: null });
    });

    server.post(`${p}/inventory/batch-change`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      const counts: any[] = [];
      for (const change of (body.changes || [])) {
        const adj = change.physical_count || change.adjustment || {};
        const coId = adj.catalog_object_id;
        if (!coId) continue;
        const existing = store.get<any>(NS.inventory, coId);
        const currentQty = parseInt(existing?.quantity || '0', 10);
        const changeQty = parseInt(adj.quantity || '0', 10);
        const newQty = change.type === 'ADJUSTMENT' ? currentQty + changeQty : changeQty;
        const count = {
          catalog_object_id: coId,
          catalog_object_type: adj.catalog_object_type || 'ITEM_VARIATION',
          state: adj.state || 'IN_STOCK',
          location_id: adj.location_id || generateUUID(),
          quantity: String(newQty),
          calculated_at: new Date().toISOString(),
        };
        store.set(NS.inventory, coId, count);
        counts.push(count);
      }
      return reply.send({ counts });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CUSTOMERS
    // ══════════════════════════════════════════════════════════════════════

    server.get(`${p}/customers`, async (_req, reply) => {
      return reply.send({ customers: store.list(NS.customers), cursor: null });
    });

    server.post(`${p}/customers`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ customer: existing });
      }
      const customer = {
        id: generateUUID(),
        given_name: body.given_name || '',
        family_name: body.family_name || '',
        email_address: body.email_address || null,
        phone_number: body.phone_number || null,
        address: body.address || null,
        company_name: body.company_name || null,
        reference_id: body.reference_id || null,
        note: body.note || null,
        preferences: { email_unsubscribed: false },
        creation_source: 'THIRD_PARTY',
        version: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.set(NS.customers, customer.id, customer);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, customer);
      return reply.send({ customer });
    });

    server.get(`${p}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get(NS.customers, id);
      if (!customer) return reply.status(404).send(sqError('NOT_FOUND', `Customer ${id} not found`));
      return reply.send({ customer });
    });

    server.put(`${p}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as any;
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(404).send(sqError('NOT_FOUND', `Customer ${id} not found`));
      const updated = { ...customer, ...body, updated_at: new Date().toISOString(), version: customer.version + 1 };
      store.set(NS.customers, id, updated);
      return reply.send({ customer: updated });
    });

    server.delete(`${p}/customers/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = store.get(NS.customers, id);
      if (!customer) return reply.status(404).send(sqError('NOT_FOUND', `Customer ${id} not found`));
      store.delete(NS.customers, id);
      return reply.send({});
    });

    // ══════════════════════════════════════════════════════════════════════
    //  LOCATIONS
    // ══════════════════════════════════════════════════════════════════════

    server.get(`${p}/locations`, async (_req, reply) => {
      return reply.send({ locations: store.list(NS.locations) });
    });

    server.get(`${p}/locations/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const location = store.get(NS.locations, id);
      if (!location) return reply.status(404).send(sqError('NOT_FOUND', `Location ${id} not found`));
      return reply.send({ location });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SUBSCRIPTIONS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/subscriptions`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ subscription: existing });
      }
      const subscription = {
        id: generateUUID(),
        location_id: body.location_id || generateUUID(),
        plan_variation_id: body.plan_variation_id || generateUUID(),
        customer_id: body.customer_id || generateUUID(),
        status: 'ACTIVE',
        start_date: body.start_date || new Date().toISOString().split('T')[0],
        charged_through_date: null,
        canceled_date: null,
        source: { name: 'Mimic' },
        version: 1,
        created_at: new Date().toISOString(),
        timezone: body.timezone || 'America/New_York',
      };
      store.set(NS.subscriptions, subscription.id, subscription);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, subscription);
      return reply.send({ subscription });
    });

    server.get(`${p}/subscriptions/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(sqError('NOT_FOUND', `Subscription ${id} not found`));
      return reply.send({ subscription: sub });
    });

    server.post(`${p}/subscriptions/search`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      let subscriptions = store.list<any>(NS.subscriptions);
      if (body.query?.filter?.customer_ids) {
        subscriptions = subscriptions.filter((s: any) => body.query.filter.customer_ids.includes(s.customer_id));
      }
      if (body.query?.filter?.location_ids) {
        subscriptions = subscriptions.filter((s: any) => body.query.filter.location_ids.includes(s.location_id));
      }
      return reply.send({ subscriptions, cursor: null });
    });

    server.post(`${p}/subscriptions/:id/cancel`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(sqError('NOT_FOUND', `Subscription ${id} not found`));
      store.update(NS.subscriptions, id, { status: 'CANCELED', canceled_date: new Date().toISOString().split('T')[0] });
      return reply.send({ subscription: store.get(NS.subscriptions, id) });
    });

    server.post(`${p}/subscriptions/:id/pause`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as any;
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(sqError('NOT_FOUND', `Subscription ${id} not found`));
      store.update(NS.subscriptions, id, {
        status: 'PAUSED',
        pause_effective_date: body.pause_effective_date || new Date().toISOString().split('T')[0],
      });
      return reply.send({ subscription: store.get(NS.subscriptions, id) });
    });

    server.post(`${p}/subscriptions/:id/resume`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as any;
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(sqError('NOT_FOUND', `Subscription ${id} not found`));
      store.update(NS.subscriptions, id, {
        status: 'ACTIVE',
        resume_effective_date: body.resume_effective_date || new Date().toISOString().split('T')[0],
      });
      return reply.send({ subscription: store.get(NS.subscriptions, id) });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  INVOICES
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/invoices`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ invoice: existing });
      }
      const invoiceDef = body.invoice || {};
      const invoice = {
        id: generateUUID(),
        version: 0,
        location_id: invoiceDef.location_id || generateUUID(),
        order_id: invoiceDef.order_id || generateUUID(),
        status: 'DRAFT',
        invoice_number: invoiceDef.invoice_number || `INV-${Date.now()}`,
        title: invoiceDef.title || null,
        description: invoiceDef.description || null,
        primary_recipient: invoiceDef.primary_recipient || {},
        payment_requests: (invoiceDef.payment_requests || []).map((pr: any) => ({
          uid: generateUUID(),
          request_type: pr.request_type || 'BALANCE',
          due_date: pr.due_date || new Date(Date.now() + 30 * 86400_000).toISOString().split('T')[0],
          tipping_enabled: pr.tipping_enabled || false,
          computed_amount_money: pr.fixed_amount_requested_money || { amount: 0, currency: 'USD' },
          ...pr,
        })),
        delivery_method: invoiceDef.delivery_method || 'EMAIL',
        accepted_payment_methods: invoiceDef.accepted_payment_methods || {
          card: true, square_gift_card: false, bank_account: false, buy_now_pay_later: false,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.set(NS.invoices, invoice.id, invoice);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, invoice);
      return reply.send({ invoice });
    });

    server.get(`${p}/invoices/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get(NS.invoices, id);
      if (!invoice) return reply.status(404).send(sqError('NOT_FOUND', `Invoice ${id} not found`));
      return reply.send({ invoice });
    });

    server.get(`${p}/invoices`, async (req, reply) => {
      const query = req.query as any;
      let invoices = store.list<any>(NS.invoices);
      if (query.location_id) invoices = invoices.filter((i: any) => i.location_id === query.location_id);
      return reply.send({ invoices, cursor: null });
    });

    server.post(`${p}/invoices/:id/publish`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as any;
      const invoice = store.get<any>(NS.invoices, id);
      if (!invoice) return reply.status(404).send(sqError('NOT_FOUND', `Invoice ${id} not found`));
      store.update(NS.invoices, id, {
        status: 'UNPAID',
        version: (body.version ?? invoice.version) + 1,
        public_url: `https://squareup.com/pay-invoice/${id}`,
        updated_at: new Date().toISOString(),
      });
      return reply.send({ invoice: store.get(NS.invoices, id) });
    });

    server.post(`${p}/invoices/:id/cancel`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as any;
      const invoice = store.get<any>(NS.invoices, id);
      if (!invoice) return reply.status(404).send(sqError('NOT_FOUND', `Invoice ${id} not found`));
      store.update(NS.invoices, id, {
        status: 'CANCELED',
        version: (body.version ?? invoice.version) + 1,
        updated_at: new Date().toISOString(),
      });
      return reply.send({ invoice: store.get(NS.invoices, id) });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TERMINAL
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/terminals/codes`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ device_code: existing });
      }
      const deviceCode = {
        id: generateUUID(),
        code: generateShortCode(6),
        name: body.device_code?.name || 'Terminal',
        product_type: body.device_code?.product_type || 'TERMINAL_API',
        location_id: body.device_code?.location_id || generateUUID(),
        status: 'UNPAIRED',
        pair_by: new Date(Date.now() + 300_000).toISOString(),
        created_at: new Date().toISOString(),
      };
      store.set(NS.deviceCodes, deviceCode.id, deviceCode);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, deviceCode);
      return reply.send({ device_code: deviceCode });
    });

    server.get(`${p}/terminals/codes/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const deviceCode = store.get(NS.deviceCodes, id);
      if (!deviceCode) return reply.status(404).send(sqError('NOT_FOUND', `Device code ${id} not found`));
      return reply.send({ device_code: deviceCode });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  GIFT CARDS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/gift-cards`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ gift_card: existing });
      }
      const giftCard = {
        id: generateUUID(),
        type: body.type || 'DIGITAL',
        state: 'ACTIVE',
        gan_source: 'SQUARE',
        gan: generateGAN(),
        balance_money: { amount: 0, currency: 'USD' },
        created_at: new Date().toISOString(),
      };
      store.set(NS.giftCards, giftCard.id, giftCard);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, giftCard);
      return reply.send({ gift_card: giftCard });
    });

    server.get(`${p}/gift-cards/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const giftCard = store.get(NS.giftCards, id);
      if (!giftCard) return reply.status(404).send(sqError('NOT_FOUND', `Gift card ${id} not found`));
      return reply.send({ gift_card: giftCard });
    });

    server.get(`${p}/gift-cards`, async (_req, reply) => {
      return reply.send({ gift_cards: store.list(NS.giftCards), cursor: null });
    });

    server.post(`${p}/gift-cards/activities`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ gift_card_activity: existing });
      }
      const actDef = body.gift_card_activity || {};
      const giftCard = store.get<any>(NS.giftCards, actDef.gift_card_id);
      const currentBalance = giftCard?.balance_money?.amount || 0;
      let newBalance = currentBalance;
      if (actDef.type === 'ACTIVATE' && actDef.activate_activity_details) {
        newBalance = actDef.activate_activity_details.amount_money?.amount || 0;
      } else if (actDef.type === 'LOAD' && actDef.load_activity_details) {
        newBalance = currentBalance + (actDef.load_activity_details.amount_money?.amount || 0);
      } else if (actDef.type === 'REDEEM' && actDef.redeem_activity_details) {
        newBalance = currentBalance - (actDef.redeem_activity_details.amount_money?.amount || 0);
      }
      if (giftCard) {
        store.update(NS.giftCards, actDef.gift_card_id, {
          balance_money: { amount: newBalance, currency: giftCard.balance_money.currency },
        });
      }
      const activity = {
        id: generateUUID(),
        type: actDef.type,
        location_id: actDef.location_id || generateUUID(),
        gift_card_id: actDef.gift_card_id,
        gift_card_balance_money: { amount: newBalance, currency: 'USD' },
        created_at: new Date().toISOString(),
      };
      store.set(NS.giftCardActivities, activity.id, activity);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, activity);
      return reply.send({ gift_card_activity: activity });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  BOOKINGS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/bookings`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ booking: existing });
      }
      const bookingDef = body.booking || {};
      const booking = {
        id: generateUUID(),
        status: 'ACCEPTED',
        version: 0,
        start_at: bookingDef.start_at || new Date(Date.now() + 86400_000).toISOString(),
        location_id: bookingDef.location_id || generateUUID(),
        customer_id: bookingDef.customer_id || null,
        customer_note: bookingDef.customer_note || null,
        seller_note: bookingDef.seller_note || null,
        appointment_segments: bookingDef.appointment_segments || [],
        all_day: false,
        location_type: 'BUSINESS_LOCATION',
        source: 'THIRD_PARTY',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.set(NS.bookings, booking.id, booking);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, booking);
      return reply.send({ booking });
    });

    server.get(`${p}/bookings/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const booking = store.get(NS.bookings, id);
      if (!booking) return reply.status(404).send(sqError('NOT_FOUND', `Booking ${id} not found`));
      return reply.send({ booking });
    });

    server.get(`${p}/bookings`, async (_req, reply) => {
      return reply.send({ bookings: store.list(NS.bookings), cursor: null });
    });

    server.post(`${p}/bookings/:id/cancel`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const booking = store.get<any>(NS.bookings, id);
      if (!booking) return reply.status(404).send(sqError('NOT_FOUND', `Booking ${id} not found`));
      store.update(NS.bookings, id, {
        status: 'CANCELLED_BY_SELLER',
        version: booking.version + 1,
        updated_at: new Date().toISOString(),
      });
      return reply.send({ booking: store.get(NS.bookings, id) });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  LOYALTY
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/loyalty/accounts`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ loyalty_account: existing });
      }
      const accountDef = body.loyalty_account || {};
      const account = {
        id: generateUUID(),
        program_id: accountDef.program_id || generateUUID(),
        balance: 0,
        lifetime_points: 0,
        customer_id: accountDef.customer_id || null,
        enrolled_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        mapping: accountDef.mapping || null,
      };
      store.set(NS.loyaltyAccounts, account.id, account);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, account);
      return reply.send({ loyalty_account: account });
    });

    server.get(`${p}/loyalty/programs/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const program = store.get(NS.loyaltyPrograms, id);
      if (!program) {
        return reply.send({
          program: {
            id,
            status: 'ACTIVE',
            reward_tiers: [],
            terminology: { one: 'Point', other: 'Points' },
            location_ids: store.list<any>(NS.locations).map((l: any) => l.id),
            accrual_rules: [{ accrual_type: 'SPEND', points: 1, spend_data: { amount_money: { amount: 100, currency: 'USD' } } }],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
      }
      return reply.send({ program });
    });

    server.post(`${p}/loyalty/accounts/:id/accumulate`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as any;
      const account = store.get<any>(NS.loyaltyAccounts, id);
      if (!account) return reply.status(404).send(sqError('NOT_FOUND', `Loyalty account ${id} not found`));
      const points = body.accumulate_points?.points || body.points || 0;
      store.update(NS.loyaltyAccounts, id, {
        balance: account.balance + points,
        lifetime_points: account.lifetime_points + points,
        updated_at: new Date().toISOString(),
      });
      return reply.send({
        event: {
          id: generateUUID(),
          type: 'ACCUMULATE_POINTS',
          loyalty_account_id: id,
          source: 'LOYALTY_API',
          accumulate_points: { points, order_id: body.accumulate_points?.order_id || null },
          created_at: new Date().toISOString(),
        },
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  DISPUTES
    // ══════════════════════════════════════════════════════════════════════

    server.get(`${p}/disputes`, async (_req, reply) => {
      return reply.send({ disputes: store.list(NS.disputes), cursor: null });
    });

    server.get(`${p}/disputes/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get(NS.disputes, id);
      if (!dispute) return reply.status(404).send(sqError('NOT_FOUND', `Dispute ${id} not found`));
      return reply.send({ dispute });
    });

    server.post(`${p}/disputes/:id/accept`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get(NS.disputes, id);
      if (!dispute) return reply.status(404).send(sqError('NOT_FOUND', `Dispute ${id} not found`));
      store.update(NS.disputes, id, { state: 'ACCEPTED', updated_at: new Date().toISOString() });
      return reply.send({ dispute: store.get(NS.disputes, id) });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CARDS
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/cards`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (body.idempotency_key) {
        const existing = store.get(NS.idempotency, body.idempotency_key);
        if (existing) return reply.send({ card: existing });
      }
      const cardDef = body.card || {};
      const card = {
        id: generateUUID(),
        card_brand: 'VISA',
        last_4: '1234',
        exp_month: cardDef.exp_month || 12,
        exp_year: cardDef.exp_year || 2027,
        cardholder_name: cardDef.cardholder_name || null,
        customer_id: cardDef.customer_id || null,
        reference_id: cardDef.reference_id || null,
        enabled: true,
        card_type: 'CREDIT',
        prepaid_type: 'NOT_PREPAID',
        bin: '411111',
        version: 1,
        merchant_id: generateUUID(),
        created_at: new Date().toISOString(),
      };
      store.set(NS.cards, card.id, card);
      if (body.idempotency_key) store.set(NS.idempotency, body.idempotency_key, card);
      return reply.send({ card });
    });

    server.get(`${p}/cards`, async (req, reply) => {
      const query = req.query as any;
      let cards = store.list<any>(NS.cards);
      if (query.customer_id) cards = cards.filter((c: any) => c.customer_id === query.customer_id);
      return reply.send({ cards, cursor: null });
    });

    server.get(`${p}/cards/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const card = store.get(NS.cards, id);
      if (!card) return reply.status(404).send(sqError('NOT_FOUND', `Card ${id} not found`));
      return reply.send({ card });
    });

    server.post(`${p}/cards/:id/disable`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const card = store.get(NS.cards, id);
      if (!card) return reply.status(404).send(sqError('NOT_FOUND', `Card ${id} not found`));
      store.update(NS.cards, id, { enabled: false });
      return reply.send({ card: store.get(NS.cards, id) });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TEAM
    // ══════════════════════════════════════════════════════════════════════

    server.post(`${p}/team-members/search`, async (req, reply) => {
      const body = (req.body ?? {}) as any;
      let members = store.list<any>(NS.teamMembers);
      if (body.query?.filter?.location_ids) {
        members = members.filter((m: any) =>
          m.assigned_locations?.location_ids?.some((lid: string) => body.query.filter.location_ids.includes(lid)));
      }
      if (body.query?.filter?.status) {
        members = members.filter((m: any) => m.status === body.query.filter.status);
      }
      return reply.send({ team_members: members, cursor: null });
    });

    server.get(`${p}/team-members/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const member = store.get(NS.teamMembers, id);
      if (!member) return reply.status(404).send(sqError('NOT_FOUND', `Team member ${id} not found`));
      return reply.send({ team_member: member });
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      { method: 'POST', path: '/square/v2/payments', description: 'Create payment' },
      { method: 'GET', path: '/square/v2/payments/:id', description: 'Get payment' },
      { method: 'GET', path: '/square/v2/payments', description: 'List payments' },
      { method: 'POST', path: '/square/v2/payments/:id/cancel', description: 'Cancel payment' },
      { method: 'POST', path: '/square/v2/refunds', description: 'Refund payment' },
      { method: 'GET', path: '/square/v2/refunds/:id', description: 'Get refund' },
      { method: 'GET', path: '/square/v2/refunds', description: 'List refunds' },
      { method: 'POST', path: '/square/v2/orders', description: 'Create order' },
      { method: 'GET', path: '/square/v2/orders/:id', description: 'Get order' },
      { method: 'POST', path: '/square/v2/orders/search', description: 'Search orders' },
      { method: 'POST', path: '/square/v2/orders/calculate', description: 'Calculate order' },
      { method: 'GET', path: '/square/v2/catalog/list', description: 'List catalog' },
      { method: 'POST', path: '/square/v2/catalog/object', description: 'Upsert catalog object' },
      { method: 'POST', path: '/square/v2/catalog/search', description: 'Search catalog' },
      { method: 'POST', path: '/square/v2/catalog/batch-upsert', description: 'Batch upsert catalog' },
      { method: 'POST', path: '/square/v2/inventory/batch-retrieve-counts', description: 'Get inventory counts' },
      { method: 'POST', path: '/square/v2/inventory/batch-change', description: 'Change inventory' },
      { method: 'GET', path: '/square/v2/customers', description: 'List customers' },
      { method: 'POST', path: '/square/v2/customers', description: 'Create customer' },
      { method: 'GET', path: '/square/v2/customers/:id', description: 'Retrieve customer' },
      { method: 'PUT', path: '/square/v2/customers/:id', description: 'Update customer' },
      { method: 'DELETE', path: '/square/v2/customers/:id', description: 'Delete customer' },
      { method: 'GET', path: '/square/v2/locations', description: 'List locations' },
      { method: 'GET', path: '/square/v2/locations/:id', description: 'Retrieve location' },
      { method: 'POST', path: '/square/v2/subscriptions', description: 'Create subscription' },
      { method: 'GET', path: '/square/v2/subscriptions/:id', description: 'Get subscription' },
      { method: 'POST', path: '/square/v2/subscriptions/search', description: 'Search subscriptions' },
      { method: 'POST', path: '/square/v2/subscriptions/:id/cancel', description: 'Cancel subscription' },
      { method: 'POST', path: '/square/v2/subscriptions/:id/pause', description: 'Pause subscription' },
      { method: 'POST', path: '/square/v2/subscriptions/:id/resume', description: 'Resume subscription' },
      { method: 'POST', path: '/square/v2/invoices', description: 'Create invoice' },
      { method: 'GET', path: '/square/v2/invoices/:id', description: 'Get invoice' },
      { method: 'GET', path: '/square/v2/invoices', description: 'List invoices' },
      { method: 'POST', path: '/square/v2/invoices/:id/publish', description: 'Publish invoice' },
      { method: 'POST', path: '/square/v2/invoices/:id/cancel', description: 'Cancel invoice' },
      { method: 'POST', path: '/square/v2/terminals/codes', description: 'Create device code' },
      { method: 'GET', path: '/square/v2/terminals/codes/:id', description: 'Get device code' },
      { method: 'POST', path: '/square/v2/gift-cards', description: 'Create gift card' },
      { method: 'GET', path: '/square/v2/gift-cards/:id', description: 'Retrieve gift card' },
      { method: 'GET', path: '/square/v2/gift-cards', description: 'List gift cards' },
      { method: 'POST', path: '/square/v2/gift-cards/activities', description: 'Create gift card activity' },
      { method: 'POST', path: '/square/v2/bookings', description: 'Create booking' },
      { method: 'GET', path: '/square/v2/bookings/:id', description: 'Get booking' },
      { method: 'GET', path: '/square/v2/bookings', description: 'List bookings' },
      { method: 'POST', path: '/square/v2/bookings/:id/cancel', description: 'Cancel booking' },
      { method: 'POST', path: '/square/v2/loyalty/accounts', description: 'Create loyalty account' },
      { method: 'GET', path: '/square/v2/loyalty/programs/:id', description: 'Get loyalty program' },
      { method: 'POST', path: '/square/v2/loyalty/accounts/:id/accumulate', description: 'Accumulate points' },
      { method: 'GET', path: '/square/v2/disputes', description: 'List disputes' },
      { method: 'GET', path: '/square/v2/disputes/:id', description: 'Get dispute' },
      { method: 'POST', path: '/square/v2/disputes/:id/accept', description: 'Accept dispute' },
      { method: 'POST', path: '/square/v2/cards', description: 'Create card' },
      { method: 'GET', path: '/square/v2/cards', description: 'List cards' },
      { method: 'GET', path: '/square/v2/cards/:id', description: 'Get card' },
      { method: 'POST', path: '/square/v2/cards/:id/disable', description: 'Disable card' },
      { method: 'POST', path: '/square/v2/team-members/search', description: 'Search team members' },
      { method: 'GET', path: '/square/v2/team-members/:id', description: 'Get team member' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    payments: NS.payments,
    refunds: NS.refunds,
    orders: NS.orders,
    catalog: NS.catalog,
    customers: NS.customers,
    locations: NS.locations,
    subscriptions: NS.subscriptions,
    invoices: NS.invoices,
    gift_cards: NS.giftCards,
    bookings: NS.bookings,
    disputes: NS.disputes,
    cards: NS.cards,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const sqData = expanded.apiResponses?.square;
      if (!sqData) continue;

      for (const [resourceType, responses] of Object.entries(sqData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const key = (body.id as string);
          if (!key) continue;
          store.set(namespace, String(key), body);
        }
      }
    }
  }
}
