import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData, DataSpec } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { PayPalConfig } from './config.js';
import { ppError } from './paypal-errors.js';
import { registerPayPalTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  orders: 'pp_orders',
  auths: 'pp_auths',
  captures: 'pp_captures',
  refunds: 'pp_refunds',
  payouts: 'pp_payouts',
  disputes: 'pp_disputes',
  plans: 'pp_plans',
  subs: 'pp_subs',
  invoices: 'pp_invoices',
  setupTokens: 'pp_setup_tokens',
  paymentTokens: 'pp_payment_tokens',
  webhooks: 'pp_webhooks',
  webhookEvents: 'pp_webhook_events',
  tracking: 'pp_tracking',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a PayPal-style 17-char uppercase alphanumeric ID */
function ppId(): string {
  return generateId('', 17).toUpperCase();
}

// ---------------------------------------------------------------------------
// PayPal Adapter
// ---------------------------------------------------------------------------

export class PayPalAdapter extends BaseApiMockAdapter<PayPalConfig> {
  readonly id = 'paypal';
  readonly name = 'PayPal API';
  readonly basePath = '/paypal';
  readonly versions = ['v1', 'v2', 'v3'];
  readonly promptContext = {
    resources: ['orders', 'payments', 'captures', 'refunds', 'subscriptions', 'plans', 'products', 'disputes', 'payouts'],
    amountFormat: 'decimal string with currency object (e.g. { value: "29.99", currency_code: "USD" })',
    relationships: [
      'order → payer',
      'capture → order',
      'refund → capture',
      'subscription → plan, subscriber',
      'plan → product',
      'dispute → transaction',
    ],
    requiredFields: {
      orders: ['id', 'status', 'intent', 'purchase_units', 'create_time'],
      captures: ['id', 'status', 'amount', 'create_time'],
      refunds: ['id', 'status', 'amount', 'create_time'],
      subscriptions: ['id', 'status', 'plan_id', 'subscriber', 'start_time', 'create_time'],
      plans: ['id', 'product_id', 'name', 'status', 'billing_cycles', 'create_time'],
      products: ['id', 'name', 'type', 'create_time'],
    },
    notes: 'Amounts are decimal strings in {value, currency_code} objects. Timestamps are ISO 8601. Order status: CREATED, SAVED, APPROVED, VOIDED, COMPLETED, PAYER_ACTION_REQUIRED. Subscription status: APPROVAL_PENDING, APPROVED, ACTIVE, SUSPENDED, CANCELLED, EXPIRED.',
  };

  readonly dataSpec: DataSpec = {
    timestampFormat: 'iso8601',
    amountFields: ['amount'],
    statusEnums: {
      orders: ['CREATED', 'SAVED', 'APPROVED', 'VOIDED', 'COMPLETED', 'PAYER_ACTION_REQUIRED'],
      subscriptions: ['APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
    },
    timestampFields: ['create_time', 'update_time', 'start_time'],
  };

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerPayPalTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const token = auth.replace('Bearer ', '');
    const match = token.match(/^A21AAK_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    // ── Seed from expanded apiResponses ──────────────────────────────────
    this.seedFromApiResponses(data, store);

    // ══════════════════════════════════════════════════════════════════════
    //  AUTHENTICATION
    // ══════════════════════════════════════════════════════════════════════

    server.post('/paypal/v1/oauth2/token', async (req, reply) => {
      return reply.send({
        scope: 'https://uri.paypal.com/services/payments/payment https://uri.paypal.com/services/payments/refund',
        access_token: `A21AAK_${generateId('', 32)}`,
        token_type: 'Bearer',
        app_id: 'APP-80W284485P519543T',
        expires_in: 32400,
        nonce: `${new Date().toISOString()}-${generateId('', 16)}`,
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  ORDERS (Checkout v2)
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Order ────────────────────────────────────────────────────
    server.post('/paypal/v2/checkout/orders', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const purchaseUnits = (body.purchase_units as any[]) || [];
      const orderId = ppId();

      const order = {
        id: orderId,
        status: 'CREATED',
        intent: body.intent || 'CAPTURE',
        purchase_units: purchaseUnits.map((pu: any, i: number) => ({
          reference_id: pu.reference_id || `PU_${i}`,
          amount: {
            currency_code: pu.amount?.currency_code || 'USD',
            value: pu.amount?.value || '0.00',
            breakdown: {
              item_total: { currency_code: pu.amount?.currency_code || 'USD', value: pu.amount?.value || '0.00' },
              shipping: { currency_code: pu.amount?.currency_code || 'USD', value: '0.00' },
              tax_total: { currency_code: pu.amount?.currency_code || 'USD', value: '0.00' },
            },
          },
          description: pu.description || '',
          items: pu.items || [],
          shipping: pu.shipping || {},
        })),
        payment_source: body.payment_source || {},
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v2/checkout/orders/${orderId}`, rel: 'self', method: 'GET' },
          { href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`, rel: 'approve', method: 'GET' },
          { href: `/v2/checkout/orders/${orderId}/authorize`, rel: 'authorize', method: 'POST' },
          { href: `/v2/checkout/orders/${orderId}/capture`, rel: 'capture', method: 'POST' },
        ],
      };
      store.set(NS.orders, orderId, order);
      return reply.status(201).send(order);
    });

    // ── Get Order ───────────────────────────────────────────────────────
    server.get('/paypal/v2/checkout/orders/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = store.get(NS.orders, id);
      if (!order) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Order ${id} not found`));
      return reply.send(order);
    });

    // ── Update Order ────────────────────────────────────────────────────
    server.patch('/paypal/v2/checkout/orders/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, id);
      if (!order) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Order ${id} not found`));
      const patches = (req.body ?? []) as any[];
      for (const patch of patches) {
        if (patch.op === 'replace' && patch.path && patch.value !== undefined) {
          const key = patch.path.replace(/^\//, '').replace(/\//g, '.');
          const parts = key.split('.');
          let target: any = order;
          for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
          target[parts[parts.length - 1]] = patch.value;
        }
      }
      store.update(NS.orders, id, { ...order, update_time: new Date().toISOString() });
      return reply.status(204).send();
    });

    // ── Authorize Order ─────────────────────────────────────────────────
    server.post('/paypal/v2/checkout/orders/:id/authorize', async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, id);
      if (!order) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Order ${id} not found`));

      const purchaseUnits = (order.purchase_units as any[]) || [];
      const authId = ppId();
      const auth = {
        id: authId,
        status: 'CREATED',
        amount: purchaseUnits[0]?.amount || { currency_code: 'USD', value: '0.00' },
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        expiration_time: new Date(Date.now() + 3 * 86400_000).toISOString(),
        links: [
          { href: `/v2/payments/authorizations/${authId}`, rel: 'self', method: 'GET' },
          { href: `/v2/payments/authorizations/${authId}/capture`, rel: 'capture', method: 'POST' },
          { href: `/v2/payments/authorizations/${authId}/void`, rel: 'void', method: 'POST' },
        ],
      };
      store.set(NS.auths, authId, auth);

      const updatedUnits = purchaseUnits.map((pu: any) => ({
        ...pu,
        payments: { authorizations: [auth] },
      }));
      store.update(NS.orders, id, {
        status: 'APPROVED',
        purchase_units: updatedUnits,
        update_time: new Date().toISOString(),
      });
      return reply.send(store.get(NS.orders, id));
    });

    // ── Capture Order ───────────────────────────────────────────────────
    server.post('/paypal/v2/checkout/orders/:id/capture', async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, id);
      if (!order) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Order ${id} not found`));

      const purchaseUnits = (order.purchase_units as any[]) || [];
      const captureId = ppId();
      const capture = {
        id: captureId,
        status: 'COMPLETED',
        amount: purchaseUnits[0]?.amount || { currency_code: 'USD', value: '0.00' },
        final_capture: true,
        seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] },
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v2/payments/captures/${captureId}`, rel: 'self', method: 'GET' },
          { href: `/v2/payments/captures/${captureId}/refund`, rel: 'refund', method: 'POST' },
        ],
      };
      store.set(NS.captures, captureId, capture);

      const updatedUnits = purchaseUnits.map((pu: any) => ({
        ...pu,
        payments: { captures: [capture] },
      }));
      store.update(NS.orders, id, {
        status: 'COMPLETED',
        purchase_units: updatedUnits,
        update_time: new Date().toISOString(),
      });
      return reply.send(store.get(NS.orders, id));
    });

    // ── Add Tracking ────────────────────────────────────────────────────
    server.post('/paypal/v2/checkout/orders/:id/track', async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = store.get<Record<string, unknown>>(NS.orders, id);
      if (!order) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Order ${id} not found`));

      const body = (req.body ?? {}) as Record<string, unknown>;
      const trackerId = ppId();
      const tracker = {
        id: trackerId,
        status: body.status || 'SHIPPED',
        carrier: (body as any).carrier || 'OTHER',
        tracking_number: (body as any).tracking_number || '',
        notify_payer: (body as any).notify_payer ?? true,
        create_time: new Date().toISOString(),
      };
      store.set(NS.tracking, trackerId, tracker);
      return reply.status(201).send(tracker);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYMENTS v2
    // ══════════════════════════════════════════════════════════════════════

    // ── Get Authorization ───────────────────────────────────────────────
    server.get('/paypal/v2/payments/authorizations/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const auth = store.get(NS.auths, id);
      if (!auth) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Authorization ${id} not found`));
      return reply.send(auth);
    });

    // ── Capture Authorization ───────────────────────────────────────────
    server.post('/paypal/v2/payments/authorizations/:id/capture', async (req, reply) => {
      const { id } = req.params as { id: string };
      const auth = store.get<Record<string, unknown>>(NS.auths, id);
      if (!auth) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Authorization ${id} not found`));
      if (auth.status === 'VOIDED') return reply.status(422).send(ppError('UNPROCESSABLE_ENTITY', 'Authorization has been voided'));

      const body = (req.body ?? {}) as Record<string, unknown>;
      const captureId = ppId();
      const capture = {
        id: captureId,
        status: 'COMPLETED',
        amount: body.amount || auth.amount,
        final_capture: body.final_capture ?? true,
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v2/payments/captures/${captureId}`, rel: 'self', method: 'GET' },
          { href: `/v2/payments/captures/${captureId}/refund`, rel: 'refund', method: 'POST' },
        ],
      };
      store.set(NS.captures, captureId, capture);
      store.update(NS.auths, id, { status: 'CAPTURED', update_time: new Date().toISOString() });
      return reply.status(201).send(capture);
    });

    // ── Void Authorization ──────────────────────────────────────────────
    server.post('/paypal/v2/payments/authorizations/:id/void', async (req, reply) => {
      const { id } = req.params as { id: string };
      const auth = store.get<Record<string, unknown>>(NS.auths, id);
      if (!auth) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Authorization ${id} not found`));
      if (auth.status === 'CAPTURED') return reply.status(422).send(ppError('UNPROCESSABLE_ENTITY', 'Authorization has already been captured'));
      store.update(NS.auths, id, { status: 'VOIDED', update_time: new Date().toISOString() });
      return reply.status(204).send();
    });

    // ── Get Capture ─────────────────────────────────────────────────────
    server.get('/paypal/v2/payments/captures/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const capture = store.get(NS.captures, id);
      if (!capture) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Capture ${id} not found`));
      return reply.send(capture);
    });

    // ── Refund Capture ──────────────────────────────────────────────────
    server.post('/paypal/v2/payments/captures/:id/refund', async (req, reply) => {
      const { id } = req.params as { id: string };
      const capture = store.get<Record<string, unknown>>(NS.captures, id);
      if (!capture) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Capture ${id} not found`));

      const body = (req.body ?? {}) as Record<string, unknown>;
      const refundId = ppId();
      const refund = {
        id: refundId,
        status: 'COMPLETED',
        amount: body.amount || capture.amount,
        note_to_payer: body.note_to_payer || '',
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v2/payments/refunds/${refundId}`, rel: 'self', method: 'GET' },
        ],
      };
      store.set(NS.refunds, refundId, refund);
      return reply.status(201).send(refund);
    });

    // ── Get Refund ──────────────────────────────────────────────────────
    server.get('/paypal/v2/payments/refunds/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const refund = store.get(NS.refunds, id);
      if (!refund) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Refund ${id} not found`));
      return reply.send(refund);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  PAYOUTS v1
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Batch Payout ─────────────────────────────────────────────
    server.post('/paypal/v1/payments/payouts', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const batchId = ppId();
      const items = ((body.items as any[]) || []).map((item: any) => ({
        payout_item_id: ppId(),
        transaction_status: 'SUCCESS',
        payout_batch_id: batchId,
        payout_item: item,
        payout_item_fee: { value: '0.25', currency: item.amount?.currency || 'USD' },
        time_processed: new Date().toISOString(),
        links: [],
      }));

      const batch = {
        batch_header: {
          payout_batch_id: batchId,
          batch_status: 'PENDING',
          sender_batch_header: body.sender_batch_header || {},
          time_created: new Date().toISOString(),
          time_completed: new Date().toISOString(),
          funding_source: 'BALANCE',
          amount: { currency: 'USD', value: '0.00' },
          fees: { currency: 'USD', value: '0.00' },
        },
        items,
        links: [
          { href: `/v1/payments/payouts/${batchId}`, rel: 'self', method: 'GET' },
        ],
      };

      // Store items individually for lookup
      items.forEach((item: any) => store.set(NS.payouts, item.payout_item_id, item));
      store.set(NS.payouts, batchId, batch);
      return reply.status(201).send(batch);
    });

    // ── Get Payout Batch ────────────────────────────────────────────────
    server.get('/paypal/v1/payments/payouts/:batch_id', async (req, reply) => {
      const { batch_id } = req.params as { batch_id: string };
      const batch = store.get(NS.payouts, batch_id);
      if (!batch) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Payout batch ${batch_id} not found`));
      return reply.send(batch);
    });

    // ── Get Payout Item ─────────────────────────────────────────────────
    server.get('/paypal/v1/payments/payouts-item/:item_id', async (req, reply) => {
      const { item_id } = req.params as { item_id: string };
      const item = store.get(NS.payouts, item_id);
      if (!item) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Payout item ${item_id} not found`));
      return reply.send(item);
    });

    // ══════════════════════════════════════════════════════════════════════
    //  DISPUTES v1
    // ══════════════════════════════════════════════════════════════════════

    // ── List Disputes ───────────────────────────────────────────────────
    server.get('/paypal/v1/customer/disputes', async (_req, reply) => {
      const disputes = store.list<Record<string, unknown>>(NS.disputes);
      if (disputes.length === 0) {
        // Generate sample disputes
        const sampleDisputes = Array.from({ length: 2 }, (_, i) => ({
          dispute_id: `PP-D-${ppId()}`,
          status: i === 0 ? 'OPEN' : 'RESOLVED',
          reason: i === 0 ? 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' : 'UNAUTHORISED',
          dispute_amount: { currency_code: 'USD', value: `${(50 + i * 25).toFixed(2)}` },
          create_time: new Date(Date.now() - i * 7 * 86400_000).toISOString(),
          update_time: new Date().toISOString(),
          links: [],
        }));
        sampleDisputes.forEach((d) => store.set(NS.disputes, d.dispute_id, d));
        return reply.send({ items: sampleDisputes, total_items: sampleDisputes.length });
      }
      return reply.send({ items: disputes, total_items: disputes.length });
    });

    // ── Get Dispute ─────────────────────────────────────────────────────
    server.get('/paypal/v1/customer/disputes/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get(NS.disputes, id);
      if (!dispute) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Dispute ${id} not found`));
      return reply.send(dispute);
    });

    // ── Accept Claim ────────────────────────────────────────────────────
    server.post('/paypal/v1/customer/disputes/:id/accept-claim', async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get<Record<string, unknown>>(NS.disputes, id);
      if (!dispute) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Dispute ${id} not found`));

      const body = (req.body ?? {}) as Record<string, unknown>;
      store.update(NS.disputes, id, {
        status: 'RESOLVED',
        resolution: 'BUYER_FAVOR',
        note: body.note || 'Claim accepted',
        update_time: new Date().toISOString(),
      });
      return reply.send(store.get(NS.disputes, id));
    });

    // ── Provide Evidence ────────────────────────────────────────────────
    server.post('/paypal/v1/customer/disputes/:id/provide-evidence', async (req, reply) => {
      const { id } = req.params as { id: string };
      const dispute = store.get<Record<string, unknown>>(NS.disputes, id);
      if (!dispute) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Dispute ${id} not found`));

      store.update(NS.disputes, id, {
        status: 'UNDER_REVIEW',
        update_time: new Date().toISOString(),
      });
      return reply.send(store.get(NS.disputes, id));
    });

    // ══════════════════════════════════════════════════════════════════════
    //  BILLING / SUBSCRIPTIONS v1
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Plan ─────────────────────────────────────────────────────
    server.post('/paypal/v1/billing/plans', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const planId = `P-${generateId('', 24).toUpperCase()}`;
      const plan = {
        id: planId,
        product_id: body.product_id || `PROD-${generateId('', 13).toUpperCase()}`,
        status: 'ACTIVE',
        name: body.name || 'Plan',
        description: body.description || '',
        billing_cycles: body.billing_cycles || [],
        payment_preferences: body.payment_preferences || {
          auto_bill_outstanding: true,
          setup_fee: { currency_code: 'USD', value: '0.00' },
          setup_fee_failure_action: 'CONTINUE',
          payment_failure_threshold: 3,
        },
        taxes: body.taxes || { percentage: '0', inclusive: false },
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v1/billing/plans/${planId}`, rel: 'self', method: 'GET' },
        ],
      };
      store.set(NS.plans, planId, plan);
      return reply.status(201).send(plan);
    });

    // ── List Plans ──────────────────────────────────────────────────────
    server.get('/paypal/v1/billing/plans', async (_req, reply) => {
      const plans = store.list(NS.plans);
      return reply.send({
        plans,
        total_items: plans.length,
        total_pages: 1,
        links: [],
      });
    });

    // ── Create Subscription ─────────────────────────────────────────────
    server.post('/paypal/v1/billing/subscriptions', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const subId = `I-${generateId('', 13).toUpperCase()}`;
      const sub = {
        id: subId,
        plan_id: body.plan_id || '',
        status: 'ACTIVE',
        status_update_time: new Date().toISOString(),
        start_time: (body.start_time as string) || new Date().toISOString(),
        subscriber: body.subscriber || {},
        billing_info: {
          outstanding_balance: { currency_code: 'USD', value: '0.00' },
          cycle_executions: [],
          next_billing_time: new Date(Date.now() + 30 * 86400_000).toISOString(),
          failed_payments_count: 0,
        },
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v1/billing/subscriptions/${subId}`, rel: 'self', method: 'GET' },
          { href: `/v1/billing/subscriptions/${subId}/cancel`, rel: 'cancel', method: 'POST' },
          { href: `/v1/billing/subscriptions/${subId}/suspend`, rel: 'suspend', method: 'POST' },
        ],
      };
      store.set(NS.subs, subId, sub);
      return reply.status(201).send(sub);
    });

    // ── Get Subscription ────────────────────────────────────────────────
    server.get('/paypal/v1/billing/subscriptions/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subs, id);
      if (!sub) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Subscription ${id} not found`));
      return reply.send(sub);
    });

    // ── Cancel Subscription ─────────────────────────────────────────────
    server.post('/paypal/v1/billing/subscriptions/:id/cancel', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subs, id);
      if (!sub) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Subscription ${id} not found`));
      store.update(NS.subs, id, { status: 'CANCELLED', status_update_time: new Date().toISOString(), update_time: new Date().toISOString() });
      return reply.status(204).send();
    });

    // ── Suspend Subscription ────────────────────────────────────────────
    server.post('/paypal/v1/billing/subscriptions/:id/suspend', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subs, id);
      if (!sub) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Subscription ${id} not found`));
      store.update(NS.subs, id, { status: 'SUSPENDED', status_update_time: new Date().toISOString(), update_time: new Date().toISOString() });
      return reply.status(204).send();
    });

    // ── Activate Subscription ───────────────────────────────────────────
    server.post('/paypal/v1/billing/subscriptions/:id/activate', async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = store.get(NS.subs, id);
      if (!sub) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Subscription ${id} not found`));
      store.update(NS.subs, id, { status: 'ACTIVE', status_update_time: new Date().toISOString(), update_time: new Date().toISOString() });
      return reply.status(204).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  INVOICING v2
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Invoice ──────────────────────────────────────────────────
    server.post('/paypal/v2/invoicing/invoices', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const invId = `INV2-${generateId('', 4).toUpperCase()}-${generateId('', 4).toUpperCase()}-${generateId('', 4).toUpperCase()}-${generateId('', 4).toUpperCase()}`;
      const invoice = {
        id: invId,
        status: 'DRAFT',
        detail: body.detail || { currency_code: 'USD' },
        invoicer: body.invoicer || {},
        primary_recipients: body.primary_recipients || [],
        items: body.items || [],
        amount: body.amount || { currency_code: 'USD', value: '0.00' },
        due_amount: body.amount || { currency_code: 'USD', value: '0.00' },
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v2/invoicing/invoices/${invId}`, rel: 'self', method: 'GET' },
          { href: `/v2/invoicing/invoices/${invId}/send`, rel: 'send', method: 'POST' },
        ],
      };
      store.set(NS.invoices, invId, invoice);
      return reply.status(201).send(invoice);
    });

    // ── List Invoices ───────────────────────────────────────────────────
    server.get('/paypal/v2/invoicing/invoices', async (_req, reply) => {
      const invoices = store.list(NS.invoices);
      return reply.send({ total_items: invoices.length, items: invoices });
    });

    // ── Get Invoice ─────────────────────────────────────────────────────
    server.get('/paypal/v2/invoicing/invoices/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get(NS.invoices, id);
      if (!invoice) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Invoice ${id} not found`));
      return reply.send(invoice);
    });

    // ── Send Invoice ────────────────────────────────────────────────────
    server.post('/paypal/v2/invoicing/invoices/:id/send', async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = store.get(NS.invoices, id);
      if (!invoice) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Invoice ${id} not found`));
      store.update(NS.invoices, id, { status: 'SENT', update_time: new Date().toISOString() });
      return reply.status(202).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TRANSACTION SEARCH v1
    // ══════════════════════════════════════════════════════════════════════

    server.get('/paypal/v1/reporting/transactions', async (req, reply) => {
      const query = req.query as Record<string, string>;
      // Return transactions from captured orders
      const captures = store.list<Record<string, unknown>>(NS.captures);
      const transactions = captures.map((c) => ({
        transaction_info: {
          transaction_id: c.id as string,
          transaction_event_code: 'T0006',
          transaction_initiation_date: c.create_time as string,
          transaction_updated_date: c.update_time as string,
          transaction_amount: c.amount,
          transaction_status: c.status,
        },
        payer_info: { account_id: ppId(), email_address: 'buyer@example.com' },
      }));
      return reply.send({
        transaction_details: transactions,
        total_items: transactions.length,
        total_pages: 1,
        links: [],
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  VAULT v3 – Payment Method Tokens
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Setup Token ──────────────────────────────────────────────
    server.post('/paypal/v3/vault/setup-tokens', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tokenId = ppId();
      const setupToken = {
        id: tokenId,
        status: 'APPROVED',
        payment_source: body.payment_source || {},
        customer: body.customer || { id: ppId() },
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v3/vault/setup-tokens/${tokenId}`, rel: 'self', method: 'GET' },
        ],
      };
      store.set(NS.setupTokens, tokenId, setupToken);
      return reply.status(201).send(setupToken);
    });

    // ── Create Payment Token ────────────────────────────────────────────
    server.post('/paypal/v3/vault/payment-tokens', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tokenId = ppId();
      const paymentToken = {
        id: tokenId,
        status: 'ACTIVE',
        payment_source: body.payment_source || {},
        customer: body.customer || { id: ppId() },
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v3/vault/payment-tokens/${tokenId}`, rel: 'self', method: 'GET' },
          { href: `/v3/vault/payment-tokens/${tokenId}`, rel: 'delete', method: 'DELETE' },
        ],
      };
      store.set(NS.paymentTokens, tokenId, paymentToken);
      return reply.status(201).send(paymentToken);
    });

    // ── List Payment Tokens ─────────────────────────────────────────────
    server.get('/paypal/v3/vault/payment-tokens', async (req, reply) => {
      const tokens = store.list(NS.paymentTokens);
      return reply.send({
        payment_tokens: tokens,
        total_items: tokens.length,
        total_pages: 1,
        links: [],
      });
    });

    // ── Delete Payment Token ────────────────────────────────────────────
    server.delete('/paypal/v3/vault/payment-tokens/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const token = store.get(NS.paymentTokens, id);
      if (!token) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Payment token ${id} not found`));
      store.delete(NS.paymentTokens, id);
      return reply.status(204).send();
    });

    // ══════════════════════════════════════════════════════════════════════
    //  WEBHOOKS v1
    // ══════════════════════════════════════════════════════════════════════

    // ── Create Webhook ──────────────────────────────────────────────────
    server.post('/paypal/v1/notifications/webhooks', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const webhookId = ppId();
      const webhook = {
        id: webhookId,
        url: body.url || '',
        event_types: body.event_types || [],
        create_time: new Date().toISOString(),
        update_time: new Date().toISOString(),
        links: [
          { href: `/v1/notifications/webhooks/${webhookId}`, rel: 'self', method: 'GET' },
          { href: `/v1/notifications/webhooks/${webhookId}`, rel: 'delete', method: 'DELETE' },
        ],
      };
      store.set(NS.webhooks, webhookId, webhook);
      return reply.status(201).send(webhook);
    });

    // ── List Webhooks ───────────────────────────────────────────────────
    server.get('/paypal/v1/notifications/webhooks', async (_req, reply) => {
      const webhooks = store.list(NS.webhooks);
      return reply.send({ webhooks });
    });

    // ── Delete Webhook ──────────────────────────────────────────────────
    server.delete('/paypal/v1/notifications/webhooks/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const webhook = store.get(NS.webhooks, id);
      if (!webhook) return reply.status(404).send(ppError('RESOURCE_NOT_FOUND', `Webhook ${id} not found`));
      store.delete(NS.webhooks, id);
      return reply.status(204).send();
    });

    // ── List Webhook Events ─────────────────────────────────────────────
    server.get('/paypal/v1/notifications/webhooks-events', async (_req, reply) => {
      const events = store.list(NS.webhookEvents);
      return reply.send({ events, count: events.length });
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Auth
      { method: 'POST', path: '/paypal/v1/oauth2/token', description: 'Get access token' },
      // Orders
      { method: 'POST', path: '/paypal/v2/checkout/orders', description: 'Create order' },
      { method: 'GET', path: '/paypal/v2/checkout/orders/:id', description: 'Get order' },
      { method: 'PATCH', path: '/paypal/v2/checkout/orders/:id', description: 'Update order' },
      { method: 'POST', path: '/paypal/v2/checkout/orders/:id/authorize', description: 'Authorize order' },
      { method: 'POST', path: '/paypal/v2/checkout/orders/:id/capture', description: 'Capture order' },
      { method: 'POST', path: '/paypal/v2/checkout/orders/:id/track', description: 'Add tracking' },
      // Payments
      { method: 'GET', path: '/paypal/v2/payments/authorizations/:id', description: 'Get authorization' },
      { method: 'POST', path: '/paypal/v2/payments/authorizations/:id/capture', description: 'Capture authorization' },
      { method: 'POST', path: '/paypal/v2/payments/authorizations/:id/void', description: 'Void authorization' },
      { method: 'GET', path: '/paypal/v2/payments/captures/:id', description: 'Get capture' },
      { method: 'POST', path: '/paypal/v2/payments/captures/:id/refund', description: 'Refund capture' },
      { method: 'GET', path: '/paypal/v2/payments/refunds/:id', description: 'Get refund' },
      // Payouts
      { method: 'POST', path: '/paypal/v1/payments/payouts', description: 'Create batch payout' },
      { method: 'GET', path: '/paypal/v1/payments/payouts/:batch_id', description: 'Get payout batch' },
      { method: 'GET', path: '/paypal/v1/payments/payouts-item/:item_id', description: 'Get payout item' },
      // Disputes
      { method: 'GET', path: '/paypal/v1/customer/disputes', description: 'List disputes' },
      { method: 'GET', path: '/paypal/v1/customer/disputes/:id', description: 'Get dispute' },
      { method: 'POST', path: '/paypal/v1/customer/disputes/:id/accept-claim', description: 'Accept claim' },
      { method: 'POST', path: '/paypal/v1/customer/disputes/:id/provide-evidence', description: 'Provide evidence' },
      // Billing
      { method: 'POST', path: '/paypal/v1/billing/plans', description: 'Create billing plan' },
      { method: 'GET', path: '/paypal/v1/billing/plans', description: 'List billing plans' },
      { method: 'POST', path: '/paypal/v1/billing/subscriptions', description: 'Create subscription' },
      { method: 'GET', path: '/paypal/v1/billing/subscriptions/:id', description: 'Get subscription' },
      { method: 'POST', path: '/paypal/v1/billing/subscriptions/:id/cancel', description: 'Cancel subscription' },
      { method: 'POST', path: '/paypal/v1/billing/subscriptions/:id/suspend', description: 'Suspend subscription' },
      { method: 'POST', path: '/paypal/v1/billing/subscriptions/:id/activate', description: 'Activate subscription' },
      // Invoicing
      { method: 'POST', path: '/paypal/v2/invoicing/invoices', description: 'Create invoice' },
      { method: 'GET', path: '/paypal/v2/invoicing/invoices', description: 'List invoices' },
      { method: 'GET', path: '/paypal/v2/invoicing/invoices/:id', description: 'Get invoice' },
      { method: 'POST', path: '/paypal/v2/invoicing/invoices/:id/send', description: 'Send invoice' },
      // Transactions
      { method: 'GET', path: '/paypal/v1/reporting/transactions', description: 'List transactions' },
      // Vault
      { method: 'POST', path: '/paypal/v3/vault/setup-tokens', description: 'Create setup token' },
      { method: 'POST', path: '/paypal/v3/vault/payment-tokens', description: 'Create payment token' },
      { method: 'GET', path: '/paypal/v3/vault/payment-tokens', description: 'List payment tokens' },
      { method: 'DELETE', path: '/paypal/v3/vault/payment-tokens/:id', description: 'Delete payment token' },
      // Webhooks
      { method: 'POST', path: '/paypal/v1/notifications/webhooks', description: 'Create webhook' },
      { method: 'GET', path: '/paypal/v1/notifications/webhooks', description: 'List webhooks' },
      { method: 'DELETE', path: '/paypal/v1/notifications/webhooks/:id', description: 'Delete webhook' },
      { method: 'GET', path: '/paypal/v1/notifications/webhooks-events', description: 'List webhook events' },
    ];
  }

  // ── Cross-surface seeding ──────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    orders: NS.orders,
    captures: NS.captures,
    refunds: NS.refunds,
    authorizations: NS.auths,
    payouts: NS.payouts,
    disputes: NS.disputes,
    plans: NS.plans,
    subscriptions: NS.subs,
    invoices: NS.invoices,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const ppData = expanded.apiResponses?.paypal;
      if (!ppData) continue;

      for (const [resourceType, responses] of Object.entries(ppData.responses)) {
        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          const key =
            (body.id as string) ??
            (body.dispute_id as string) ??
            (body.batch_header as any)?.payout_batch_id;
          if (!key) continue;

          store.set(namespace, String(key), body);
        }
      }
    }
  }
}
