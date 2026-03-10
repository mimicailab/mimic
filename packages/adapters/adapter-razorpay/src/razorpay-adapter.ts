import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { RazorpayConfig } from './config.js';
import { rzpError } from './razorpay-errors.js';
import { registerRazorpayTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  orders: 'rzp_orders',
  payments: 'rzp_payments',
  refunds: 'rzp_refunds',
  customers: 'rzp_customers',
  plans: 'rzp_plans',
  subscriptions: 'rzp_subscriptions',
  invoices: 'rzp_invoices',
  plinks: 'rzp_plinks',
  settlements: 'rzp_settlements',
  virtualAccounts: 'rzp_virtual_accounts',
  qrCodes: 'rzp_qr_codes',
  fundAccounts: 'rzp_fund_accounts',
  payouts: 'rzp_payouts',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a Razorpay-style ID with given prefix and 14 alphanumeric chars */
function rzpId(prefix: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = prefix;
  for (let i = 0; i < 14; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

/** Current unix timestamp (seconds) */
function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Razorpay collection wrapper */
function collection(items: any[]) {
  return {
    entity: 'collection',
    count: items.length,
    items,
  };
}

// ---------------------------------------------------------------------------
// Razorpay Adapter
// ---------------------------------------------------------------------------

export class RazorpayAdapter extends BaseApiMockAdapter<RazorpayConfig> {
  readonly id = 'razorpay';
  readonly name = 'Razorpay API';
  readonly basePath = '/razorpay/v1';
  readonly versions = ['v1'];

  readonly promptContext = {
    resources: ['customers', 'orders', 'payments', 'refunds', 'subscriptions', 'plans', 'invoices', 'settlements'],
    amountFormat: 'integer paise (e.g. 29900 = ₹299.00)',
    relationships: [
      'payment → order, customer',
      'refund → payment',
      'subscription → customer, plan',
      'invoice → customer, subscription',
    ],
    requiredFields: {
      customers: ['id', 'name', 'email', 'contact', 'created_at'],
      orders: ['id', 'amount', 'currency', 'status', 'created_at'],
      payments: ['id', 'amount', 'currency', 'status', 'method', 'order_id', 'created_at'],
      refunds: ['id', 'payment_id', 'amount', 'currency', 'status', 'created_at'],
      subscriptions: ['id', 'plan_id', 'customer_id', 'status', 'total_count', 'created_at'],
      plans: ['id', 'period', 'interval', 'item', 'created_at'],
    },
    notes: 'Indian payment gateway. Amounts in paise (1 INR = 100 paise). Timestamps are Unix seconds. Payment status: created, authorized, captured, refunded, failed. IDs prefixed: cust_, order_, pay_, rfnd_, sub_, plan_.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'unix_seconds',
    idPrefixes: { customers: 'cust_', orders: 'order_', payments: 'pay_', refunds: 'rfnd_', subscriptions: 'sub_', plans: 'plan_' },
    amountFields: ['amount'],
    statusEnums: {
      payments: ['created', 'authorized', 'captured', 'refunded', 'failed'],
      orders: ['created', 'attempted', 'paid'],
      subscriptions: ['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired'],
    },
    timestampFields: ['created_at'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerRazorpayTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    // Basic auth: base64(key_id:key_secret)
    try {
      const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
      const keyId = decoded.split(':')[0];
      const match = keyId.match(/^rzp_test_([a-zA-Z0-9]+)$/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    // ══════════════════════════════════════════════════════════════════════
    //  ORDERS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Order ────────────────────────────────────────────────────
    server.post('/razorpay/v1/orders', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (!body.amount || !body.currency) {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'The amount field is required.',
          'amount',
          'business',
          'input_validation_failed',
        ));
      }
      const order = {
        id: rzpId('order_'),
        entity: 'order',
        amount: body.amount,
        amount_paid: 0,
        amount_due: body.amount,
        currency: body.currency || 'INR',
        receipt: body.receipt || null,
        offer_id: body.offer_id || null,
        status: 'created',
        attempts: 0,
        notes: body.notes || {},
        created_at: now(),
      };
      store.set(NS.orders, order.id, order);
      return reply.status(200).send(order);
    });

    // ── Get Order ───────────────────────────────────────────────────────
    server.get('/razorpay/v1/orders/:id', async (req, reply) => {
      const { id } = req.params as any;
      const order = store.get<any>(NS.orders, id);
      if (!order) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(order);
    });

    // ── List Orders ─────────────────────────────────────────────────────
    server.get('/razorpay/v1/orders', async (_req, reply) => {
      const orders = store.list<any>(NS.orders);
      return reply.send(collection(orders));
    });

    // ── Fetch Payments for Order ────────────────────────────────────────
    server.get('/razorpay/v1/orders/:id/payments', async (req, reply) => {
      const { id } = req.params as any;
      const order = store.get<any>(NS.orders, id);
      if (!order) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      const payments = store.list<any>(NS.payments).filter((p: any) => p.order_id === id);
      return reply.send(collection(payments));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENTS
    // ══════════════════════════════════════════════════════════════════════

    // ── List Payments ───────────────────────────────────────────────────
    server.get('/razorpay/v1/payments', async (_req, reply) => {
      const payments = store.list<any>(NS.payments);
      return reply.send(collection(payments));
    });

    // ── Get Payment ─────────────────────────────────────────────────────
    server.get('/razorpay/v1/payments/:id', async (req, reply) => {
      const { id } = req.params as any;
      // Avoid matching /payments/qr_codes
      if (id === 'qr_codes') return;
      const payment = store.get<any>(NS.payments, id);
      if (!payment) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(payment);
    });

    // ── Capture Payment ─────────────────────────────────────────────────
    server.post('/razorpay/v1/payments/:id/capture', async (req, reply) => {
      const { id } = req.params as any;
      const body = (req.body ?? {}) as any;
      const payment = store.get<any>(NS.payments, id);
      if (!payment) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      if (payment.status !== 'authorized') {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'This payment has already been captured',
          null,
          'business',
          'input_validation_failed',
        ));
      }
      const captureAmount = body.amount || payment.amount;
      store.update(NS.payments, id, {
        status: 'captured',
        amount: captureAmount,
        captured: true,
      });
      // Update the parent order
      if (payment.order_id) {
        const order = store.get<any>(NS.orders, payment.order_id);
        if (order) {
          store.update(NS.orders, payment.order_id, {
            status: 'paid',
            amount_paid: captureAmount,
            amount_due: order.amount - captureAmount,
          });
        }
      }
      return reply.send(store.get(NS.payments, id));
    });

    // ── Refund Payment ──────────────────────────────────────────────────
    server.post('/razorpay/v1/payments/:id/refund', async (req, reply) => {
      const { id } = req.params as any;
      const body = (req.body ?? {}) as any;
      const payment = store.get<any>(NS.payments, id);
      if (!payment) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      if (payment.status !== 'captured') {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'The payment has not been captured yet',
          null,
          'business',
          'input_validation_failed',
        ));
      }
      const refundAmount = body.amount || payment.amount;
      const refund = {
        id: rzpId('rfnd_'),
        entity: 'refund',
        amount: refundAmount,
        currency: payment.currency,
        payment_id: id,
        notes: body.notes || {},
        receipt: body.receipt || null,
        acquirer_data: { arn: null },
        created_at: now(),
        batch_id: null,
        status: 'processed',
        speed_processed: body.speed || 'normal',
        speed_requested: body.speed || 'normal',
      };
      store.set(NS.refunds, refund.id, refund);
      store.update(NS.payments, id, { status: 'refunded', amount_refunded: refundAmount });
      return reply.status(200).send(refund);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  REFUNDS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Standalone Refund ────────────────────────────────────────
    server.post('/razorpay/v1/refunds', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (!body.payment_id) {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'The payment_id field is required.',
          'payment_id',
          'business',
          'input_validation_failed',
        ));
      }
      const payment = store.get<any>(NS.payments, body.payment_id);
      if (!payment) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'payment_id',
        'business',
        'input_validation_failed',
      ));
      const refundAmount = body.amount || payment.amount;
      const refund = {
        id: rzpId('rfnd_'),
        entity: 'refund',
        amount: refundAmount,
        currency: payment.currency,
        payment_id: body.payment_id,
        notes: body.notes || {},
        receipt: body.receipt || null,
        acquirer_data: { arn: null },
        created_at: now(),
        batch_id: null,
        status: 'processed',
        speed_processed: body.speed || 'normal',
        speed_requested: body.speed || 'normal',
      };
      store.set(NS.refunds, refund.id, refund);
      return reply.status(200).send(refund);
    });

    // ── Get Refund ──────────────────────────────────────────────────────
    server.get('/razorpay/v1/refunds/:id', async (req, reply) => {
      const { id } = req.params as any;
      const refund = store.get<any>(NS.refunds, id);
      if (!refund) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(refund);
    });

    // ── List Refunds ────────────────────────────────────────────────────
    server.get('/razorpay/v1/refunds', async (_req, reply) => {
      const refunds = store.list<any>(NS.refunds);
      return reply.send(collection(refunds));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  CUSTOMERS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Customer ─────────────────────────────────────────────────
    server.post('/razorpay/v1/customers', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      const customer = {
        id: rzpId('cust_'),
        entity: 'customer',
        name: body.name || null,
        email: body.email || null,
        contact: body.contact || null,
        gstin: body.gstin || null,
        notes: body.notes || {},
        created_at: now(),
      };
      store.set(NS.customers, customer.id, customer);
      return reply.status(200).send(customer);
    });

    // ── Get Customer ────────────────────────────────────────────────────
    server.get('/razorpay/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(customer);
    });

    // ── List Customers ──────────────────────────────────────────────────
    server.get('/razorpay/v1/customers', async (_req, reply) => {
      const customers = store.list<any>(NS.customers);
      return reply.send(collection(customers));
    });

    // ── Update Customer ─────────────────────────────────────────────────
    server.put('/razorpay/v1/customers/:id', async (req, reply) => {
      const { id } = req.params as any;
      const body = (req.body ?? {}) as any;
      const customer = store.get<any>(NS.customers, id);
      if (!customer) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      const updates: any = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.email !== undefined) updates.email = body.email;
      if (body.contact !== undefined) updates.contact = body.contact;
      if (body.gstin !== undefined) updates.gstin = body.gstin;
      if (body.notes !== undefined) updates.notes = body.notes;
      store.update(NS.customers, id, updates);
      return reply.send(store.get(NS.customers, id));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PLANS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Plan ─────────────────────────────────────────────────────
    server.post('/razorpay/v1/plans', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (!body.period || !body.interval || !body.item) {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'The period, interval, and item fields are required.',
          null,
          'business',
          'input_validation_failed',
        ));
      }
      const plan = {
        id: rzpId('plan_'),
        entity: 'plan',
        interval: body.interval,
        period: body.period,
        item: {
          id: rzpId('item_'),
          active: true,
          amount: body.item.amount,
          unit_amount: body.item.amount,
          currency: body.item.currency || 'INR',
          name: body.item.name,
          description: body.item.description || null,
        },
        notes: body.notes || {},
        created_at: now(),
      };
      store.set(NS.plans, plan.id, plan);
      return reply.status(200).send(plan);
    });

    // ── Get Plan ────────────────────────────────────────────────────────
    server.get('/razorpay/v1/plans/:id', async (req, reply) => {
      const { id } = req.params as any;
      const plan = store.get<any>(NS.plans, id);
      if (!plan) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(plan);
    });

    // ── List Plans ──────────────────────────────────────────────────────
    server.get('/razorpay/v1/plans', async (_req, reply) => {
      const plans = store.list<any>(NS.plans);
      return reply.send(collection(plans));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SUBSCRIPTIONS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Subscription ─────────────────────────────────────────────
    server.post('/razorpay/v1/subscriptions', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (!body.plan_id) {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'The plan_id field is required.',
          'plan_id',
          'business',
          'input_validation_failed',
        ));
      }
      const sub = {
        id: rzpId('sub_'),
        entity: 'subscription',
        plan_id: body.plan_id,
        customer_id: body.customer_id || null,
        status: 'created',
        current_start: null,
        current_end: null,
        ended_at: null,
        quantity: body.quantity || 1,
        notes: body.notes || {},
        charge_at: now() + 86400,
        start_at: body.start_at || now(),
        end_at: body.end_at || null,
        auth_attempts: 0,
        total_count: body.total_count || 6,
        paid_count: 0,
        remaining_count: body.total_count || 6,
        customer_notify: body.customer_notify || 1,
        created_at: now(),
        short_url: `https://rzp.io/i/${rzpId('')}`,
        has_scheduled_changes: false,
        change_scheduled_at: null,
        source: 'api',
        payment_method: 'card',
        offer_id: body.offer_id || null,
      };
      store.set(NS.subscriptions, sub.id, sub);
      return reply.status(200).send(sub);
    });

    // ── Get Subscription ────────────────────────────────────────────────
    server.get('/razorpay/v1/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.subscriptions, id);
      if (!sub) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(sub);
    });

    // ── List Subscriptions ──────────────────────────────────────────────
    server.get('/razorpay/v1/subscriptions', async (_req, reply) => {
      const subs = store.list<any>(NS.subscriptions);
      return reply.send(collection(subs));
    });

    // ── Cancel Subscription ─────────────────────────────────────────────
    server.post('/razorpay/v1/subscriptions/:id/cancel', async (req, reply) => {
      const { id } = req.params as any;
      const body = (req.body ?? {}) as any;
      const sub = store.get<any>(NS.subscriptions, id);
      if (!sub) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      const cancelAtEnd = body.cancel_at_cycle_end === 1 || body.cancel_at_cycle_end === true;
      store.update(NS.subscriptions, id, {
        status: cancelAtEnd ? 'active' : 'cancelled',
        ended_at: cancelAtEnd ? null : now(),
        has_scheduled_changes: cancelAtEnd,
      });
      return reply.send(store.get(NS.subscriptions, id));
    });

    // ── Pause Subscription ──────────────────────────────────────────────
    server.post('/razorpay/v1/subscriptions/:id/pause', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.subscriptions, id);
      if (!sub) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      if (sub.status !== 'active') {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'Only active subscriptions can be paused',
          null,
          'business',
          'input_validation_failed',
        ));
      }
      store.update(NS.subscriptions, id, { status: 'paused', paused_at: now() });
      return reply.send(store.get(NS.subscriptions, id));
    });

    // ── Resume Subscription ─────────────────────────────────────────────
    server.post('/razorpay/v1/subscriptions/:id/resume', async (req, reply) => {
      const { id } = req.params as any;
      const sub = store.get<any>(NS.subscriptions, id);
      if (!sub) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      if (sub.status !== 'paused') {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'Only paused subscriptions can be resumed',
          null,
          'business',
          'input_validation_failed',
        ));
      }
      store.update(NS.subscriptions, id, { status: 'active', paused_at: null });
      return reply.send(store.get(NS.subscriptions, id));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  INVOICES
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Invoice ──────────────────────────────────────────────────
    server.post('/razorpay/v1/invoices', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      const lineItems = (body.line_items || []).map((li: any) => ({
        id: rzpId('li_'),
        item_id: li.item_id || null,
        name: li.name,
        description: li.description || null,
        amount: li.amount,
        unit_amount: li.amount,
        gross_amount: li.amount,
        tax_amount: 0,
        taxable_amount: li.amount,
        net_amount: li.amount,
        currency: li.currency || 'INR',
        quantity: li.quantity || 1,
      }));
      const totalAmount = lineItems.reduce((sum: number, li: any) => sum + li.amount * (li.quantity || 1), 0);
      const invoice = {
        id: rzpId('inv_'),
        entity: 'invoice',
        type: body.type || 'invoice',
        invoice_number: body.invoice_number || null,
        customer_id: body.customer_id || null,
        customer_details: body.customer_details || {
          name: body.customer?.name || null,
          email: body.customer?.email || null,
          contact: body.customer?.contact || null,
          billing_address: null,
          shipping_address: null,
        },
        order_id: null,
        line_items: lineItems,
        payment_id: null,
        status: 'draft',
        expire_by: body.expire_by || null,
        issued_at: null,
        paid_at: null,
        cancelled_at: null,
        expired_at: null,
        sms_status: null,
        email_status: null,
        date: body.date || now(),
        terms: body.terms || null,
        partial_payment: body.partial_payment || false,
        gross_amount: totalAmount,
        tax_amount: 0,
        taxable_amount: totalAmount,
        amount: totalAmount,
        amount_paid: 0,
        amount_due: totalAmount,
        currency: body.currency || 'INR',
        description: body.description || null,
        notes: body.notes || {},
        short_url: null,
        view_less: true,
        billing_start: null,
        billing_end: null,
        group_taxes_discounts: false,
        created_at: now(),
      };
      store.set(NS.invoices, invoice.id, invoice);
      return reply.status(200).send(invoice);
    });

    // ── Get Invoice ─────────────────────────────────────────────────────
    server.get('/razorpay/v1/invoices/:id', async (req, reply) => {
      const { id } = req.params as any;
      const invoice = store.get<any>(NS.invoices, id);
      if (!invoice) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(invoice);
    });

    // ── List Invoices ───────────────────────────────────────────────────
    server.get('/razorpay/v1/invoices', async (_req, reply) => {
      const invoices = store.list<any>(NS.invoices);
      return reply.send(collection(invoices));
    });

    // ── Issue Invoice ───────────────────────────────────────────────────
    server.post('/razorpay/v1/invoices/:id/issue', async (req, reply) => {
      const { id } = req.params as any;
      const invoice = store.get<any>(NS.invoices, id);
      if (!invoice) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      if (invoice.status !== 'draft') {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'Only draft invoices can be issued',
          null,
          'business',
          'input_validation_failed',
        ));
      }
      store.update(NS.invoices, id, {
        status: 'issued',
        issued_at: now(),
        short_url: `https://rzp.io/i/${rzpId('')}`,
      });
      return reply.send(store.get(NS.invoices, id));
    });

    // ── Cancel Invoice ──────────────────────────────────────────────────
    server.post('/razorpay/v1/invoices/:id/cancel', async (req, reply) => {
      const { id } = req.params as any;
      const invoice = store.get<any>(NS.invoices, id);
      if (!invoice) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      store.update(NS.invoices, id, {
        status: 'cancelled',
        cancelled_at: now(),
      });
      return reply.send(store.get(NS.invoices, id));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENT LINKS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Payment Link ─────────────────────────────────────────────
    server.post('/razorpay/v1/payment_links', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (!body.amount) {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'The amount field is required.',
          'amount',
          'business',
          'input_validation_failed',
        ));
      }
      const plink = {
        id: rzpId('plink_'),
        entity: 'payment_link',
        amount: body.amount,
        currency: body.currency || 'INR',
        accept_partial: body.accept_partial || false,
        first_min_partial_amount: body.first_min_partial_amount || 0,
        description: body.description || null,
        customer: body.customer || {},
        notify: body.notify || { sms: true, email: true },
        reminder_enable: body.reminder_enable !== undefined ? body.reminder_enable : true,
        notes: body.notes || {},
        callback_url: body.callback_url || null,
        callback_method: body.callback_method || null,
        status: 'created',
        expire_by: body.expire_by || 0,
        expired_at: 0,
        cancelled_at: 0,
        paid_at: 0,
        amount_paid: 0,
        short_url: `https://rzp.io/i/${rzpId('')}`,
        created_at: now(),
        updated_at: now(),
        reference_id: body.reference_id || null,
        order_id: null,
        payments: null,
        user_id: null,
      };
      store.set(NS.plinks, plink.id, plink);
      return reply.status(200).send(plink);
    });

    // ── Get Payment Link ────────────────────────────────────────────────
    server.get('/razorpay/v1/payment_links/:id', async (req, reply) => {
      const { id } = req.params as any;
      const plink = store.get<any>(NS.plinks, id);
      if (!plink) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(plink);
    });

    // ── List Payment Links ──────────────────────────────────────────────
    server.get('/razorpay/v1/payment_links', async (_req, reply) => {
      const plinks = store.list<any>(NS.plinks);
      return reply.send(collection(plinks));
    });

    // ── Cancel Payment Link ─────────────────────────────────────────────
    server.post('/razorpay/v1/payment_links/:id/cancel', async (req, reply) => {
      const { id } = req.params as any;
      const plink = store.get<any>(NS.plinks, id);
      if (!plink) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      store.update(NS.plinks, id, {
        status: 'cancelled',
        cancelled_at: now(),
      });
      return reply.send(store.get(NS.plinks, id));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  SETTLEMENTS
    // ══════════════════════════════════════════════════════════════════════

    // ── Get Settlement ──────────────────────────────────────────────────
    server.get('/razorpay/v1/settlements/:id', async (req, reply) => {
      const { id } = req.params as any;
      const settlement = store.get<any>(NS.settlements, id);
      if (!settlement) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(settlement);
    });

    // ── List Settlements ────────────────────────────────────────────────
    server.get('/razorpay/v1/settlements', async (_req, reply) => {
      const settlements = store.list<any>(NS.settlements);
      return reply.send(collection(settlements));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  VIRTUAL ACCOUNTS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Virtual Account ──────────────────────────────────────────
    server.post('/razorpay/v1/virtual_accounts', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      const va = {
        id: rzpId('va_'),
        entity: 'virtual_account',
        name: body.name || 'Virtual Account',
        description: body.description || null,
        amount_expected: body.amount_expected || null,
        amount_paid: 0,
        customer_id: body.customer_id || null,
        receivers: body.receivers || [],
        close_by: body.close_by || now() + 86400 * 30,
        closed_at: null,
        status: 'active',
        notes: body.notes || {},
        created_at: now(),
      };
      store.set(NS.virtualAccounts, va.id, va);
      return reply.status(200).send(va);
    });

    // ── Get Virtual Account ─────────────────────────────────────────────
    server.get('/razorpay/v1/virtual_accounts/:id', async (req, reply) => {
      const { id } = req.params as any;
      const va = store.get<any>(NS.virtualAccounts, id);
      if (!va) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(va);
    });

    // ── List Virtual Accounts ───────────────────────────────────────────
    server.get('/razorpay/v1/virtual_accounts', async (_req, reply) => {
      const vas = store.list<any>(NS.virtualAccounts);
      return reply.send(collection(vas));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  QR CODES
    // ══════════════════════════════════════════════════════════════════════

    // ── Create QR Code ──────────────────────────────────────────────────
    server.post('/razorpay/v1/payments/qr_codes', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      const qr = {
        id: rzpId('qr_'),
        entity: 'qr_code',
        name: body.name || 'QR Code',
        usage: body.usage || 'single_use',
        type: body.type || 'upi_qr',
        image_url: `https://rzp.io/qr/${rzpId('')}`,
        payment_amount: body.payment_amount || null,
        status: 'active',
        description: body.description || null,
        fixed_amount: body.fixed_amount || false,
        payments_amount_received: 0,
        payments_count_received: 0,
        notes: body.notes || {},
        customer_id: body.customer_id || null,
        close_by: body.close_by || now() + 86400 * 30,
        closed_at: null,
        close_reason: null,
        created_at: now(),
      };
      store.set(NS.qrCodes, qr.id, qr);
      return reply.status(200).send(qr);
    });

    // ── Get QR Code ─────────────────────────────────────────────────────
    server.get('/razorpay/v1/payments/qr_codes/:id', async (req, reply) => {
      const { id } = req.params as any;
      const qr = store.get<any>(NS.qrCodes, id);
      if (!qr) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(qr);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  FUND ACCOUNTS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Fund Account ─────────────────────────────────────────────
    server.post('/razorpay/v1/fund_accounts', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (!body.contact_id || !body.account_type) {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'The contact_id and account_type fields are required.',
          null,
          'business',
          'input_validation_failed',
        ));
      }
      const fa = {
        id: rzpId('fa_'),
        entity: 'fund_account',
        contact_id: body.contact_id,
        account_type: body.account_type,
        bank_account: body.bank_account || null,
        vpa: body.vpa || null,
        card: body.card || null,
        active: true,
        batch_id: null,
        created_at: now(),
      };
      store.set(NS.fundAccounts, fa.id, fa);
      return reply.status(200).send(fa);
    });

    // ── List Fund Accounts ──────────────────────────────────────────────
    server.get('/razorpay/v1/fund_accounts', async (_req, reply) => {
      const fas = store.list<any>(NS.fundAccounts);
      return reply.send(collection(fas));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYOUTS
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Payout ───────────────────────────────────────────────────
    server.post('/razorpay/v1/payouts', async (req, reply) => {
      const body = (req.body ?? {}) as any;
      if (!body.account_number || !body.fund_account_id || !body.amount) {
        return reply.status(400).send(rzpError(
          'BAD_REQUEST_ERROR',
          'The account_number, fund_account_id, and amount fields are required.',
          null,
          'business',
          'input_validation_failed',
        ));
      }
      const payout = {
        id: rzpId('pout_'),
        entity: 'payout',
        fund_account_id: body.fund_account_id,
        amount: body.amount,
        currency: body.currency || 'INR',
        notes: body.notes || {},
        fees: Math.round(body.amount * 0.01),
        tax: Math.round(body.amount * 0.0018),
        status: 'processing',
        purpose: body.purpose || 'payout',
        utr: null,
        mode: body.mode || 'NEFT',
        reference_id: body.reference_id || null,
        narration: body.narration || null,
        batch_id: null,
        failure_reason: null,
        created_at: now(),
      };
      store.set(NS.payouts, payout.id, payout);
      return reply.status(200).send(payout);
    });

    // ── Get Payout ──────────────────────────────────────────────────────
    server.get('/razorpay/v1/payouts/:id', async (req, reply) => {
      const { id } = req.params as any;
      const payout = store.get<any>(NS.payouts, id);
      if (!payout) return reply.status(400).send(rzpError(
        'BAD_REQUEST_ERROR',
        'The id provided does not exist',
        'id',
        'business',
        'input_validation_failed',
      ));
      return reply.send(payout);
    });

    // ── List Payouts ────────────────────────────────────────────────────
    server.get('/razorpay/v1/payouts', async (_req, reply) => {
      const payouts = store.list<any>(NS.payouts);
      return reply.send(collection(payouts));
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Orders
      { method: 'POST', path: '/razorpay/v1/orders', description: 'Create order' },
      { method: 'GET', path: '/razorpay/v1/orders/:id', description: 'Get order' },
      { method: 'GET', path: '/razorpay/v1/orders', description: 'List orders' },
      { method: 'GET', path: '/razorpay/v1/orders/:id/payments', description: 'Order payments' },
      // Payments
      { method: 'GET', path: '/razorpay/v1/payments', description: 'List payments' },
      { method: 'GET', path: '/razorpay/v1/payments/:id', description: 'Get payment' },
      { method: 'POST', path: '/razorpay/v1/payments/:id/capture', description: 'Capture payment' },
      { method: 'POST', path: '/razorpay/v1/payments/:id/refund', description: 'Refund payment' },
      // Refunds
      { method: 'POST', path: '/razorpay/v1/refunds', description: 'Create refund' },
      { method: 'GET', path: '/razorpay/v1/refunds/:id', description: 'Get refund' },
      { method: 'GET', path: '/razorpay/v1/refunds', description: 'List refunds' },
      // Customers
      { method: 'POST', path: '/razorpay/v1/customers', description: 'Create customer' },
      { method: 'GET', path: '/razorpay/v1/customers/:id', description: 'Get customer' },
      { method: 'GET', path: '/razorpay/v1/customers', description: 'List customers' },
      { method: 'PUT', path: '/razorpay/v1/customers/:id', description: 'Update customer' },
      // Plans
      { method: 'POST', path: '/razorpay/v1/plans', description: 'Create plan' },
      { method: 'GET', path: '/razorpay/v1/plans/:id', description: 'Get plan' },
      { method: 'GET', path: '/razorpay/v1/plans', description: 'List plans' },
      // Subscriptions
      { method: 'POST', path: '/razorpay/v1/subscriptions', description: 'Create subscription' },
      { method: 'GET', path: '/razorpay/v1/subscriptions/:id', description: 'Get subscription' },
      { method: 'GET', path: '/razorpay/v1/subscriptions', description: 'List subscriptions' },
      { method: 'POST', path: '/razorpay/v1/subscriptions/:id/cancel', description: 'Cancel subscription' },
      { method: 'POST', path: '/razorpay/v1/subscriptions/:id/pause', description: 'Pause subscription' },
      { method: 'POST', path: '/razorpay/v1/subscriptions/:id/resume', description: 'Resume subscription' },
      // Invoices
      { method: 'POST', path: '/razorpay/v1/invoices', description: 'Create invoice' },
      { method: 'GET', path: '/razorpay/v1/invoices/:id', description: 'Get invoice' },
      { method: 'GET', path: '/razorpay/v1/invoices', description: 'List invoices' },
      { method: 'POST', path: '/razorpay/v1/invoices/:id/issue', description: 'Issue invoice' },
      { method: 'POST', path: '/razorpay/v1/invoices/:id/cancel', description: 'Cancel invoice' },
      // Payment Links
      { method: 'POST', path: '/razorpay/v1/payment_links', description: 'Create payment link' },
      { method: 'GET', path: '/razorpay/v1/payment_links/:id', description: 'Get payment link' },
      { method: 'GET', path: '/razorpay/v1/payment_links', description: 'List payment links' },
      { method: 'POST', path: '/razorpay/v1/payment_links/:id/cancel', description: 'Cancel payment link' },
      // Settlements
      { method: 'GET', path: '/razorpay/v1/settlements/:id', description: 'Get settlement' },
      { method: 'GET', path: '/razorpay/v1/settlements', description: 'List settlements' },
      // Virtual Accounts
      { method: 'POST', path: '/razorpay/v1/virtual_accounts', description: 'Create virtual account' },
      { method: 'GET', path: '/razorpay/v1/virtual_accounts/:id', description: 'Get virtual account' },
      { method: 'GET', path: '/razorpay/v1/virtual_accounts', description: 'List virtual accounts' },
      // QR Codes
      { method: 'POST', path: '/razorpay/v1/payments/qr_codes', description: 'Create QR code' },
      { method: 'GET', path: '/razorpay/v1/payments/qr_codes/:id', description: 'Get QR code' },
      // Fund Accounts
      { method: 'POST', path: '/razorpay/v1/fund_accounts', description: 'Create fund account' },
      { method: 'GET', path: '/razorpay/v1/fund_accounts', description: 'List fund accounts' },
      // Payouts
      { method: 'POST', path: '/razorpay/v1/payouts', description: 'Create payout' },
      { method: 'GET', path: '/razorpay/v1/payouts/:id', description: 'Get payout' },
      { method: 'GET', path: '/razorpay/v1/payouts', description: 'List payouts' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    orders: NS.orders,
    payments: NS.payments,
    refunds: NS.refunds,
    customers: NS.customers,
    plans: NS.plans,
    subscriptions: NS.subscriptions,
    invoices: NS.invoices,
    payment_links: NS.plinks,
    settlements: NS.settlements,
    virtual_accounts: NS.virtualAccounts,
    qr_codes: NS.qrCodes,
    fund_accounts: NS.fundAccounts,
    payouts: NS.payouts,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const rzpData = expanded.apiResponses?.razorpay;
      if (!rzpData) continue;

      for (const [resourceType, responses] of Object.entries(rzpData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const key = body.id as string;
          if (!key) continue;

          store.set(namespace, String(key), body);
        }
      }
    }
  }
}
