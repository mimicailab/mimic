import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { MercadoPagoConfig } from './config.js';
import { mpError } from './mercadopago-errors.js';
import { registerMercadoPagoTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  payments: 'mp_payments',
  refunds: 'mp_refunds',
  preferences: 'mp_preferences',
  customers: 'mp_customers',
  cards: 'mp_cards',
  subscriptions: 'mp_subscriptions',
  plans: 'mp_plans',
  merchantOrders: 'mp_merchant_orders',
} as const;

// ---------------------------------------------------------------------------
// MercadoPago Adapter
// ---------------------------------------------------------------------------

export class MercadoPagoAdapter extends BaseApiMockAdapter<MercadoPagoConfig> {
  readonly id = 'mercadopago';
  readonly name = 'Mercado Pago API';
  readonly basePath = '/mercadopago';
  readonly versions = ['v1'];
  readonly promptContext = {
    resources: ['payments', 'preferences', 'customers', 'cards', 'refunds', 'preapprovals', 'merchant_orders'],
    amountFormat: 'decimal float (e.g. 29.99)',
    relationships: [
      'payment → customer, preference',
      'refund → payment',
      'card → customer',
      'preapproval → customer',
      'merchant_order → preference',
    ],
    requiredFields: {
      payments: ['id', 'transaction_amount', 'currency_id', 'status', 'status_detail', 'payment_method_id', 'payment_type_id', 'date_created'],
      customers: ['id', 'email', 'first_name', 'last_name', 'date_created'],
      preferences: ['id', 'items', 'payer', 'date_created'],
      refunds: ['id', 'payment_id', 'amount', 'status', 'date_created'],
    },
    notes: 'Latin American payment platform. Amounts as decimal floats. Timestamps ISO 8601. Payment status: pending, approved, authorized, in_process, in_mediation, rejected, cancelled, refunded, charged_back. Currency codes: ARS, BRL, CLP, MXN, COP, PEN, UYU, USD.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    amountFields: ['transaction_amount', 'amount', 'net_amount', 'total_paid_amount'],
    statusEnums: {
      payments: ['pending', 'approved', 'authorized', 'in_process', 'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back'],
    },
    timestampFields: ['date_created', 'date_approved', 'date_last_updated'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerMercadoPagoTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const token = auth.replace('Bearer ', '');
    const match = token.match(/^TEST-([a-z0-9-]+)-/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    let idCounter = 20359000;
    const nextId = () => ++idCounter;

    // ══════════════════════════════════════════════════════════════════════
    //  AUTHENTICATION
    // ══════════════════════════════════════════════════════════════════════

    server.post('/mercadopago/oauth/token', async (req, reply) => {
      return reply.send({
        access_token: `TEST-${generateId('', 16)}-${generateId('', 6)}-${generateId('', 32)}`,
        token_type: 'Bearer',
        expires_in: 21600,
        scope: 'read write offline_access',
        user_id: nextId(),
        live_mode: false,
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENTS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Payment ───────────────────────────────────────────────────
    server.post('/mercadopago/v1/payments', async (req, reply) => {
      const body = req.body as any;
      const id = nextId();
      const now = new Date().toISOString();

      const status = body.capture === false ? 'authorized' : 'approved';
      const statusDetail = status === 'approved' ? 'accredited' : 'pending_capture';

      const payment: any = {
        id,
        date_created: now,
        date_approved: status === 'approved' ? now : null,
        date_last_updated: now,
        money_release_date: status === 'approved' ? now : null,
        collector_id: nextId(),
        operation_type: 'regular_payment',
        payer: {
          id: body.payer?.id || String(nextId()),
          email: body.payer?.email || 'test_user@testuser.com',
          identification: body.payer?.identification || { type: 'CPF', number: '12345678909' },
          type: 'customer',
        },
        binary_mode: body.binary_mode || false,
        live_mode: false,
        order: {},
        external_reference: body.external_reference || null,
        description: body.description || '',
        metadata: body.metadata || {},
        currency_id: body.currency_id || 'BRL',
        transaction_amount: body.transaction_amount || 0,
        transaction_amount_refunded: 0,
        coupon_amount: 0,
        transaction_details: {
          net_received_amount: (body.transaction_amount || 0) * 0.955,
          total_paid_amount: body.transaction_amount || 0,
          overpaid_amount: 0,
          installment_amount: body.transaction_amount || 0,
        },
        fee_details: [
          { type: 'mercadopago_fee', amount: (body.transaction_amount || 0) * 0.045, fee_payer: 'collector' },
        ],
        captured: status === 'approved',
        status,
        status_detail: statusDetail,
        payment_method_id: body.payment_method_id || 'visa',
        payment_type_id: body.payment_type_id || 'credit_card',
        issuer_id: body.issuer_id || '25',
        installments: body.installments || 1,
        token: body.token || null,
        statement_descriptor: body.statement_descriptor || 'MERCADOPAGO',
        notification_url: body.notification_url || null,
        callback_url: body.callback_url || null,
        refunds: [],
      };

      store.set(NS.payments, String(id), payment);
      return reply.status(201).send(payment);
    });

    // ── Get Payment ──────────────────────────────────────────────────────
    server.get('/mercadopago/v1/payments/:id', async (req, reply) => {
      const { id } = req.params as any;
      const payment = store.get<any>(NS.payments, String(id));
      if (!payment) return reply.status(404).send(mpError('not_found', `Payment ${id} not found`, 404, 2000));
      return reply.send(payment);
    });

    // ── Update Payment (capture / cancel) ────────────────────────────────
    server.put('/mercadopago/v1/payments/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const payment = store.get<any>(NS.payments, String(id));
      if (!payment) return reply.status(404).send(mpError('not_found', `Payment ${id} not found`, 404, 2000));

      const now = new Date().toISOString();
      if (body.status === 'cancelled') {
        store.update(NS.payments, String(id), {
          status: 'cancelled',
          status_detail: 'by_collector',
          date_last_updated: now,
        });
      } else if (body.capture === true) {
        store.update(NS.payments, String(id), {
          status: 'approved',
          status_detail: 'accredited',
          captured: true,
          date_approved: now,
          date_last_updated: now,
        });
      } else {
        store.update(NS.payments, String(id), { ...body, date_last_updated: now });
      }

      return reply.send(store.get(NS.payments, String(id)));
    });

    // ── Search Payments ──────────────────────────────────────────────────
    server.get('/mercadopago/v1/payments/search', async (req, reply) => {
      const query = req.query as any;
      let payments = store.list<any>(NS.payments);

      if (query.status) payments = payments.filter((p: any) => p.status === query.status);
      if (query.external_reference) payments = payments.filter((p: any) => p.external_reference === query.external_reference);

      return reply.send({
        paging: { total: payments.length, limit: 30, offset: 0 },
        results: payments,
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  REFUNDS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Refund ────────────────────────────────────────────────────
    server.post('/mercadopago/v1/payments/:id/refunds', async (req, reply) => {
      const { id } = req.params as any;
      const body = (req.body ?? {}) as any;
      const payment = store.get<any>(NS.payments, String(id));
      if (!payment) return reply.status(404).send(mpError('not_found', `Payment ${id} not found`, 404, 2000));

      const refundId = nextId();
      const now = new Date().toISOString();
      const amount = body.amount || payment.transaction_amount;

      const refund = {
        id: refundId,
        payment_id: Number(id),
        amount,
        metadata: body.metadata || {},
        source: { id: String(payment.collector_id), name: 'collector', type: 'collector' },
        date_created: now,
        status: 'approved',
      };

      store.set(NS.refunds, String(refundId), refund);

      const isFullRefund = amount >= payment.transaction_amount;
      const refundedAmount = (payment.transaction_amount_refunded || 0) + amount;
      const refunds = [...(payment.refunds || []), refund];

      store.update(NS.payments, String(id), {
        status: isFullRefund ? 'refunded' : payment.status,
        transaction_amount_refunded: refundedAmount,
        refunds,
        date_last_updated: now,
      });

      return reply.status(201).send(refund);
    });

    // ── List Refunds for Payment ─────────────────────────────────────────
    server.get('/mercadopago/v1/payments/:id/refunds', async (req, reply) => {
      const { id } = req.params as any;
      const payment = store.get<any>(NS.payments, String(id));
      if (!payment) return reply.status(404).send(mpError('not_found', `Payment ${id} not found`, 404, 2000));
      return reply.send(payment.refunds || []);
    });

    // ── Get Refund ───────────────────────────────────────────────────────
    server.get('/mercadopago/v1/payments/:id/refunds/:refund_id', async (req, reply) => {
      const { id, refund_id } = req.params as any;
      const refund = store.get<any>(NS.refunds, String(refund_id));
      if (!refund || refund.payment_id !== Number(id)) {
        return reply.status(404).send(mpError('not_found', `Refund ${refund_id} not found`, 404, 2001));
      }
      return reply.send(refund);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PREFERENCES (Checkout Pro)
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Preference ────────────────────────────────────────────────
    server.post('/mercadopago/checkout/preferences', async (req, reply) => {
      const body = req.body as any;
      const id = generateId('', 12) + '-' + generateId('', 8);
      const now = new Date().toISOString();

      const preference = {
        id,
        collector_id: nextId(),
        client_id: String(nextId()),
        items: (body.items || []).map((item: any, i: number) => ({
          id: item.id || String(i + 1),
          title: item.title || 'Item',
          description: item.description || '',
          currency_id: item.currency_id || 'BRL',
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
        })),
        payer: body.payer || {},
        back_urls: body.back_urls || { success: '', failure: '', pending: '' },
        auto_return: body.auto_return || 'approved',
        payment_methods: body.payment_methods || {},
        notification_url: body.notification_url || null,
        external_reference: body.external_reference || null,
        expires: body.expires || false,
        date_created: now,
        init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=${id}`,
        sandbox_init_point: `https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=${id}`,
      };

      store.set(NS.preferences, id, preference);
      return reply.status(201).send(preference);
    });

    // ── Get Preference ───────────────────────────────────────────────────
    server.get('/mercadopago/checkout/preferences/:id', async (req, reply) => {
      const { id } = req.params as any;
      const pref = store.get<any>(NS.preferences, id);
      if (!pref) return reply.status(404).send(mpError('not_found', `Preference ${id} not found`, 404, 2000));
      return reply.send(pref);
    });

    // ── Update Preference ────────────────────────────────────────────────
    server.put('/mercadopago/checkout/preferences/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const pref = store.get<any>(NS.preferences, id);
      if (!pref) return reply.status(404).send(mpError('not_found', `Preference ${id} not found`, 404, 2000));
      store.update(NS.preferences, id, body);
      return reply.send(store.get(NS.preferences, id));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CUSTOMERS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Customer ──────────────────────────────────────────────────
    server.post('/mercadopago/v1/customers', async (req, reply) => {
      const body = req.body as any;
      const id = nextId();
      const now = new Date().toISOString();

      const customer = {
        id: String(id),
        email: body.email || '',
        first_name: body.first_name || '',
        last_name: body.last_name || '',
        phone: body.phone || { area_code: '', number: '' },
        identification: body.identification || { type: '', number: '' },
        address: body.address || { zip_code: '', street_name: '', street_number: null },
        description: body.description || null,
        date_registered: body.date_registered || null,
        metadata: body.metadata || {},
        default_card: null,
        default_address: null,
        cards: [],
        addresses: [],
        live_mode: false,
        date_created: now,
        date_last_updated: now,
      };

      store.set(NS.customers, String(id), customer);
      return reply.status(201).send(customer);
    });

    // ── Get Customer ─────────────────────────────────────────────────────
    server.get('/mercadopago/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const customer = store.get<any>(NS.customers, String(id));
      if (!customer) return reply.status(404).send(mpError('not_found', `Customer ${id} not found`, 404, 2000));
      return reply.send(customer);
    });

    // ── Update Customer ──────────────────────────────────────────────────
    server.put('/mercadopago/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const customer = store.get<any>(NS.customers, String(id));
      if (!customer) return reply.status(404).send(mpError('not_found', `Customer ${id} not found`, 404, 2000));
      store.update(NS.customers, String(id), { ...body, date_last_updated: new Date().toISOString() });
      return reply.send(store.get(NS.customers, String(id)));
    });

    // ── Delete Customer ──────────────────────────────────────────────────
    server.delete('/mercadopago/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const customer = store.get<any>(NS.customers, String(id));
      if (!customer) return reply.status(404).send(mpError('not_found', `Customer ${id} not found`, 404, 2000));
      store.delete(NS.customers, String(id));
      return reply.send(customer);
    });

    // ── Search Customers ─────────────────────────────────────────────────
    server.get('/mercadopago/v1/customers/search', async (req, reply) => {
      const query = req.query as any;
      let customers = store.list<any>(NS.customers);

      if (query.email) customers = customers.filter((c: any) => c.email === query.email);

      return reply.send({
        paging: { total: customers.length, limit: 10, offset: 0 },
        results: customers,
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CARDS
    // ══════════════════════════════════════════════════════════════════════

    // ── Save Card ────────────────────────────────────────────────────────
    server.post('/mercadopago/v1/customers/:customer_id/cards', async (req, reply) => {
      const { customer_id } = req.params as any;
      const body = req.body as any;
      const customer = store.get<any>(NS.customers, String(customer_id));
      if (!customer) return reply.status(404).send(mpError('not_found', `Customer ${customer_id} not found`, 404, 2000));

      const cardId = nextId();
      const card = {
        id: String(cardId),
        customer_id: String(customer_id),
        expiration_month: body.expiration_month || 12,
        expiration_year: body.expiration_year || 2030,
        first_six_digits: body.first_six_digits || '450995',
        last_four_digits: body.last_four_digits || '3704',
        payment_method: { id: body.payment_method_id || 'visa', name: 'Visa', payment_type_id: 'credit_card' },
        issuer: { id: 25, name: 'Visa' },
        cardholder: body.cardholder || { name: 'APRO', identification: { type: 'CPF', number: '12345678909' } },
        date_created: new Date().toISOString(),
        date_last_updated: new Date().toISOString(),
      };

      store.set(NS.cards, String(cardId), card);
      const cards = [...(customer.cards || []), card];
      store.update(NS.customers, String(customer_id), { cards, default_card: String(cardId) });

      return reply.status(201).send(card);
    });

    // ── List Cards ───────────────────────────────────────────────────────
    server.get('/mercadopago/v1/customers/:customer_id/cards', async (req, reply) => {
      const { customer_id } = req.params as any;
      const customer = store.get<any>(NS.customers, String(customer_id));
      if (!customer) return reply.status(404).send(mpError('not_found', `Customer ${customer_id} not found`, 404, 2000));
      return reply.send(customer.cards || []);
    });

    // ── Delete Card ──────────────────────────────────────────────────────
    server.delete('/mercadopago/v1/customers/:customer_id/cards/:card_id', async (req, reply) => {
      const { customer_id, card_id } = req.params as any;
      const customer = store.get<any>(NS.customers, String(customer_id));
      if (!customer) return reply.status(404).send(mpError('not_found', `Customer ${customer_id} not found`, 404, 2000));

      const card = store.get<any>(NS.cards, String(card_id));
      if (!card) return reply.status(404).send(mpError('not_found', `Card ${card_id} not found`, 404, 2000));

      store.delete(NS.cards, String(card_id));
      const cards = (customer.cards || []).filter((c: any) => c.id !== String(card_id));
      store.update(NS.customers, String(customer_id), { cards });

      return reply.send(card);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SUBSCRIPTIONS (Preapproval)
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Subscription ──────────────────────────────────────────────
    server.post('/mercadopago/preapproval', async (req, reply) => {
      const body = req.body as any;
      const id = generateId('', 32);
      const now = new Date().toISOString();

      const subscription = {
        id,
        payer_id: body.payer_id || nextId(),
        payer_email: body.payer_email || '',
        back_url: body.back_url || '',
        collector_id: nextId(),
        application_id: nextId(),
        status: 'authorized',
        reason: body.reason || '',
        external_reference: body.external_reference || null,
        date_created: now,
        last_modified: now,
        init_point: `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${id}`,
        sandbox_init_point: `https://sandbox.mercadopago.com.br/subscriptions/checkout?preapproval_id=${id}`,
        preapproval_plan_id: body.preapproval_plan_id || null,
        auto_recurring: body.auto_recurring || {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: 0,
          currency_id: 'BRL',
        },
        next_payment_date: new Date(Date.now() + 30 * 86400_000).toISOString(),
      };

      store.set(NS.subscriptions, id, subscription);
      return reply.status(201).send(subscription);
    });

    // ── Get Subscription ─────────────────────────────────────────────────
    server.get('/mercadopago/preapproval/:id', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(mpError('not_found', `Subscription ${id} not found`, 404, 2000));
      return reply.send(sub);
    });

    // ── Update Subscription ──────────────────────────────────────────────
    server.put('/mercadopago/preapproval/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const sub = store.get<any>(NS.subscriptions, id);
      if (!sub) return reply.status(404).send(mpError('not_found', `Subscription ${id} not found`, 404, 2000));
      store.update(NS.subscriptions, id, { ...body, last_modified: new Date().toISOString() });
      return reply.send(store.get(NS.subscriptions, id));
    });

    // ── Search Subscriptions ─────────────────────────────────────────────
    server.get('/mercadopago/preapproval/search', async (req, reply) => {
      const query = req.query as any;
      let subs = store.list<any>(NS.subscriptions);

      if (query.status) subs = subs.filter((s: any) => s.status === query.status);
      if (query.payer_email) subs = subs.filter((s: any) => s.payer_email === query.payer_email);

      return reply.send({
        paging: { total: subs.length, limit: 10, offset: 0 },
        results: subs,
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SUBSCRIPTION PLANS (Preapproval Plan)
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Plan ──────────────────────────────────────────────────────
    server.post('/mercadopago/preapproval_plan', async (req, reply) => {
      const body = req.body as any;
      const id = generateId('', 32);
      const now = new Date().toISOString();

      const plan = {
        id,
        status: 'active',
        reason: body.reason || '',
        auto_recurring: body.auto_recurring || {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: 0,
          currency_id: 'BRL',
          repetitions: null,
          billing_day: null,
          billing_day_proportional: false,
          free_trial: null,
        },
        back_url: body.back_url || '',
        collector_id: nextId(),
        application_id: nextId(),
        date_created: now,
        last_modified: now,
        init_point: `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=${id}`,
        sandbox_init_point: `https://sandbox.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=${id}`,
      };

      store.set(NS.plans, id, plan);
      return reply.status(201).send(plan);
    });

    // ── Get Plan ─────────────────────────────────────────────────────────
    server.get('/mercadopago/preapproval_plan/:id', async (req, reply) => {
      const { id } = req.params as any;
      const plan = store.get<any>(NS.plans, id);
      if (!plan) return reply.status(404).send(mpError('not_found', `Plan ${id} not found`, 404, 2000));
      return reply.send(plan);
    });

    // ── Update Plan ──────────────────────────────────────────────────────
    server.put('/mercadopago/preapproval_plan/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const plan = store.get<any>(NS.plans, id);
      if (!plan) return reply.status(404).send(mpError('not_found', `Plan ${id} not found`, 404, 2000));
      store.update(NS.plans, id, { ...body, last_modified: new Date().toISOString() });
      return reply.send(store.get(NS.plans, id));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  MERCHANT ORDERS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Merchant Order ────────────────────────────────────────────
    server.post('/mercadopago/merchant_orders', async (req, reply) => {
      const body = req.body as any;
      const id = nextId();
      const now = new Date().toISOString();

      const order = {
        id,
        status: 'opened',
        external_reference: body.external_reference || '',
        preference_id: body.preference_id || null,
        payments: [],
        shipments: [],
        collector: { id: nextId() },
        marketplace: 'NONE',
        notification_url: body.notification_url || null,
        date_created: now,
        last_updated: now,
        sponsor_id: null,
        shipping_cost: 0,
        total_amount: body.total_amount || 0,
        site_id: body.site_id || 'MLB',
        paid_amount: 0,
        refunded_amount: 0,
        payer: body.payer || {},
        items: body.items || [],
        cancelled: false,
        order_status: 'payment_required',
      };

      store.set(NS.merchantOrders, String(id), order);
      return reply.status(201).send(order);
    });

    // ── Get Merchant Order ───────────────────────────────────────────────
    server.get('/mercadopago/merchant_orders/:id', async (req, reply) => {
      const { id } = req.params as any;
      const order = store.get<any>(NS.merchantOrders, String(id));
      if (!order) return reply.status(404).send(mpError('not_found', `Merchant order ${id} not found`, 404, 2000));
      return reply.send(order);
    });

    // ── Update Merchant Order ────────────────────────────────────────────
    server.put('/mercadopago/merchant_orders/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const order = store.get<any>(NS.merchantOrders, String(id));
      if (!order) return reply.status(404).send(mpError('not_found', `Merchant order ${id} not found`, 404, 2000));
      store.update(NS.merchantOrders, String(id), { ...body, last_updated: new Date().toISOString() });
      return reply.send(store.get(NS.merchantOrders, String(id)));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENT METHODS
    // ══════════════════════════════════════════════════════════════════════

    server.get('/mercadopago/v1/payment_methods', async (_, reply) => {
      return reply.send([
        { id: 'visa', name: 'Visa', payment_type_id: 'credit_card', status: 'active', secure_thumbnail: '', thumbnail: '', min_allowed_amount: 0.5, max_allowed_amount: 50000 },
        { id: 'master', name: 'Mastercard', payment_type_id: 'credit_card', status: 'active', secure_thumbnail: '', thumbnail: '', min_allowed_amount: 0.5, max_allowed_amount: 50000 },
        { id: 'amex', name: 'American Express', payment_type_id: 'credit_card', status: 'active', secure_thumbnail: '', thumbnail: '', min_allowed_amount: 0.5, max_allowed_amount: 50000 },
        { id: 'pix', name: 'PIX', payment_type_id: 'bank_transfer', status: 'active', secure_thumbnail: '', thumbnail: '', min_allowed_amount: 0.01, max_allowed_amount: 99999999 },
        { id: 'bolbradesco', name: 'Boleto', payment_type_id: 'ticket', status: 'active', secure_thumbnail: '', thumbnail: '', min_allowed_amount: 5, max_allowed_amount: 50000 },
        { id: 'pec', name: 'Pagamento na loteria sem boleto', payment_type_id: 'atm', status: 'active', secure_thumbnail: '', thumbnail: '', min_allowed_amount: 5, max_allowed_amount: 3000 },
      ]);
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Auth
      { method: 'POST', path: '/mercadopago/oauth/token', description: 'Get OAuth access token' },
      // Payments
      { method: 'POST', path: '/mercadopago/v1/payments', description: 'Create payment' },
      { method: 'GET', path: '/mercadopago/v1/payments/:id', description: 'Get payment' },
      { method: 'PUT', path: '/mercadopago/v1/payments/:id', description: 'Update payment' },
      { method: 'GET', path: '/mercadopago/v1/payments/search', description: 'Search payments' },
      // Refunds
      { method: 'POST', path: '/mercadopago/v1/payments/:id/refunds', description: 'Create refund' },
      { method: 'GET', path: '/mercadopago/v1/payments/:id/refunds', description: 'List refunds' },
      { method: 'GET', path: '/mercadopago/v1/payments/:id/refunds/:refund_id', description: 'Get refund' },
      // Preferences
      { method: 'POST', path: '/mercadopago/checkout/preferences', description: 'Create preference' },
      { method: 'GET', path: '/mercadopago/checkout/preferences/:id', description: 'Get preference' },
      { method: 'PUT', path: '/mercadopago/checkout/preferences/:id', description: 'Update preference' },
      // Customers
      { method: 'POST', path: '/mercadopago/v1/customers', description: 'Create customer' },
      { method: 'GET', path: '/mercadopago/v1/customers/:id', description: 'Get customer' },
      { method: 'PUT', path: '/mercadopago/v1/customers/:id', description: 'Update customer' },
      { method: 'DELETE', path: '/mercadopago/v1/customers/:id', description: 'Delete customer' },
      { method: 'GET', path: '/mercadopago/v1/customers/search', description: 'Search customers' },
      // Cards
      { method: 'POST', path: '/mercadopago/v1/customers/:customer_id/cards', description: 'Save card' },
      { method: 'GET', path: '/mercadopago/v1/customers/:customer_id/cards', description: 'List cards' },
      { method: 'DELETE', path: '/mercadopago/v1/customers/:customer_id/cards/:card_id', description: 'Delete card' },
      // Subscriptions
      { method: 'POST', path: '/mercadopago/preapproval', description: 'Create subscription' },
      { method: 'GET', path: '/mercadopago/preapproval/:id', description: 'Get subscription' },
      { method: 'PUT', path: '/mercadopago/preapproval/:id', description: 'Update subscription' },
      { method: 'GET', path: '/mercadopago/preapproval/search', description: 'Search subscriptions' },
      // Plans
      { method: 'POST', path: '/mercadopago/preapproval_plan', description: 'Create plan' },
      { method: 'GET', path: '/mercadopago/preapproval_plan/:id', description: 'Get plan' },
      { method: 'PUT', path: '/mercadopago/preapproval_plan/:id', description: 'Update plan' },
      // Merchant Orders
      { method: 'POST', path: '/mercadopago/merchant_orders', description: 'Create merchant order' },
      { method: 'GET', path: '/mercadopago/merchant_orders/:id', description: 'Get merchant order' },
      { method: 'PUT', path: '/mercadopago/merchant_orders/:id', description: 'Update merchant order' },
      // Payment Methods
      { method: 'GET', path: '/mercadopago/v1/payment_methods', description: 'List payment methods' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    payments: NS.payments,
    refunds: NS.refunds,
    preferences: NS.preferences,
    customers: NS.customers,
    subscriptions: NS.subscriptions,
    plans: NS.plans,
    merchant_orders: NS.merchantOrders,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const mpData = expanded.apiResponses?.mercadopago;
      if (!mpData) continue;

      for (const [resourceType, responses] of Object.entries(mpData.responses)) {
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
