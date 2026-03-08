import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData } from '@mimicai/core';
import { RazorpayAdapter } from '../razorpay-adapter.js';

describe('RazorpayAdapter', () => {
  let ts: TestServer;
  let adapter: RazorpayAdapter;

  beforeAll(async () => {
    adapter = new RazorpayAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ──────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('razorpay');
      expect(adapter.name).toBe('Razorpay API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/razorpay/v1');
    });
  });

  // ── 2. Endpoints count ─────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 45 endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(45);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Orders ──────────────────────────────────────────────────────────

  describe('Orders', () => {
    let orderId: string;

    it('should create an order', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 50000,
          currency: 'INR',
          receipt: 'rcpt_001',
          notes: { source: 'test' },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^order_/);
      expect(body.entity).toBe('order');
      expect(body.amount).toBe(50000);
      expect(body.currency).toBe('INR');
      expect(body.status).toBe('created');
      expect(body.amount_due).toBe(50000);
      expect(body.amount_paid).toBe(0);
      orderId = body.id;
    });

    it('should get an order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/orders/${orderId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(orderId);
    });

    it('should list orders', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/orders',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entity).toBe('collection');
      expect(body.count).toBeGreaterThanOrEqual(1);
      expect(body.items).toBeInstanceOf(Array);
    });

    it('should return 400 for missing amount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/orders',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ currency: 'INR' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST_ERROR');
    });

    it('should return 400 for unknown order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/orders/order_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST_ERROR');
    });

    it('should fetch payments for an order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/orders/${orderId}/payments`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entity).toBe('collection');
      expect(body.items).toBeInstanceOf(Array);
    });
  });

  // ── 4. Payments ─────────────────────────────────────────────────────────

  describe('Payments', () => {
    let paymentId: string;

    beforeAll(async () => {
      // Seed a payment directly in the store for testing
      const payment = {
        id: 'pay_TestPayment001',
        entity: 'payment',
        amount: 50000,
        currency: 'INR',
        status: 'authorized',
        order_id: null,
        method: 'card',
        captured: false,
        description: 'Test payment',
        email: 'test@example.com',
        contact: '+919876543210',
        notes: {},
        created_at: Math.floor(Date.now() / 1000),
      };
      ts.stateStore.set('rzp_payments', payment.id, payment);
      paymentId = payment.id;
    });

    it('should list payments', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/payments',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entity).toBe('collection');
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should get a payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/payments/${paymentId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(paymentId);
      expect(res.json().status).toBe('authorized');
    });

    it('should capture a payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/payments/${paymentId}/capture`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 50000, currency: 'INR' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('captured');
      expect(body.captured).toBe(true);
    });

    it('should return 400 when capturing already captured payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/payments/${paymentId}/capture`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 50000 }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.description).toContain('already been captured');
    });

    it('should refund a captured payment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/payments/${paymentId}/refund`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 25000 }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^rfnd_/);
      expect(body.status).toBe('processed');
      expect(body.amount).toBe(25000);
    });

    it('should return 400 for unknown payment', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/payments/pay_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 5. Refunds ──────────────────────────────────────────────────────────

  describe('Refunds', () => {
    let capturedPaymentId: string;

    beforeAll(async () => {
      // Seed a captured payment for refund testing
      const payment = {
        id: 'pay_RefundTest001',
        entity: 'payment',
        amount: 100000,
        currency: 'INR',
        status: 'captured',
        captured: true,
        order_id: null,
        notes: {},
        created_at: Math.floor(Date.now() / 1000),
      };
      ts.stateStore.set('rzp_payments', payment.id, payment);
      capturedPaymentId = payment.id;
    });

    it('should create a standalone refund', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/refunds',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          payment_id: capturedPaymentId,
          amount: 50000,
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^rfnd_/);
      expect(body.entity).toBe('refund');
      expect(body.status).toBe('processed');
      expect(body.amount).toBe(50000);
      expect(body.payment_id).toBe(capturedPaymentId);
    });

    it('should return 400 when payment_id is missing', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/refunds',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 50000 }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.description).toContain('payment_id');
    });

    it('should get a refund', async () => {
      // Create a refund first
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/refunds',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ payment_id: capturedPaymentId, amount: 10000 }),
      });
      const refundId = createRes.json().id;

      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/refunds/${refundId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(refundId);
    });

    it('should list refunds', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/refunds',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should return 400 for unknown refund', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/refunds/rfnd_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 6. Customers ────────────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Rajesh Kumar',
          email: 'rajesh@example.com',
          contact: '+919876543210',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^cust_/);
      expect(body.entity).toBe('customer');
      expect(body.name).toBe('Rajesh Kumar');
      expect(body.email).toBe('rajesh@example.com');
      customerId = body.id;
    });

    it('should get a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(customerId);
    });

    it('should list customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/customers',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PUT',
        url: `/razorpay/v1/customers/${customerId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Rajesh K. Updated' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Rajesh K. Updated');
    });

    it('should return 400 for unknown customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/customers/cust_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 7. Plans ────────────────────────────────────────────────────────────

  describe('Plans', () => {
    let planId: string;

    it('should create a plan', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/plans',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          period: 'monthly',
          interval: 1,
          item: {
            name: 'Premium Plan',
            amount: 99900,
            currency: 'INR',
          },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^plan_/);
      expect(body.entity).toBe('plan');
      expect(body.period).toBe('monthly');
      expect(body.item.name).toBe('Premium Plan');
      expect(body.item.amount).toBe(99900);
      planId = body.id;
    });

    it('should get a plan', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/plans/${planId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(planId);
    });

    it('should list plans', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/plans',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/plans',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ period: 'monthly' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for unknown plan', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/plans/plan_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 8. Subscriptions ───────────────────────────────────────────────────

  describe('Subscriptions', () => {
    let planId: string;
    let subId: string;

    beforeAll(async () => {
      // Create a plan first
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/plans',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          period: 'monthly',
          interval: 1,
          item: { name: 'Sub Plan', amount: 49900, currency: 'INR' },
        }),
      });
      planId = res.json().id;
    });

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/subscriptions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          plan_id: planId,
          total_count: 12,
          quantity: 1,
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^sub_/);
      expect(body.entity).toBe('subscription');
      expect(body.status).toBe('created');
      expect(body.plan_id).toBe(planId);
      expect(body.total_count).toBe(12);
      subId = body.id;
    });

    it('should get a subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/subscriptions/${subId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(subId);
    });

    it('should list subscriptions', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/subscriptions',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should cancel a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/subscriptions/${subId}/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('cancelled');
    });

    it('should pause an active subscription', async () => {
      // Create a new subscription and set it to active
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/subscriptions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ plan_id: planId }),
      });
      const newSubId = createRes.json().id;
      // Manually set to active
      ts.stateStore.update('rzp_subscriptions', newSubId, { status: 'active' });

      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/subscriptions/${newSubId}/pause`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('paused');
    });

    it('should resume a paused subscription', async () => {
      // Create and set to paused
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/subscriptions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ plan_id: planId }),
      });
      const pausedSubId = createRes.json().id;
      ts.stateStore.update('rzp_subscriptions', pausedSubId, { status: 'paused' });

      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/subscriptions/${pausedSubId}/resume`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('active');
    });

    it('should return 400 when pausing non-active subscription', async () => {
      // Sub was cancelled above
      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/subscriptions/${subId}/pause`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.description).toContain('active');
    });

    it('should return 400 for missing plan_id', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/subscriptions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for unknown subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/subscriptions/sub_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 9. Invoices ─────────────────────────────────────────────────────────

  describe('Invoices', () => {
    let invoiceId: string;

    it('should create an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/invoices',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          type: 'invoice',
          description: 'Test invoice',
          line_items: [
            { name: 'Consulting', amount: 100000, quantity: 2 },
          ],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^inv_/);
      expect(body.entity).toBe('invoice');
      expect(body.status).toBe('draft');
      expect(body.amount).toBe(200000);
      expect(body.line_items).toHaveLength(1);
      invoiceId = body.id;
    });

    it('should get an invoice', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/invoices/${invoiceId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(invoiceId);
    });

    it('should list invoices', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/invoices',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should issue a draft invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/invoices/${invoiceId}/issue`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('issued');
      expect(res.json().issued_at).toBeDefined();
      expect(res.json().short_url).toBeTruthy();
    });

    it('should return 400 when issuing non-draft invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/invoices/${invoiceId}/issue`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.description).toContain('draft');
    });

    it('should cancel an invoice', async () => {
      // Create a new invoice to cancel
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/invoices',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          line_items: [{ name: 'Item', amount: 50000 }],
        }),
      });
      const newInvId = createRes.json().id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/invoices/${newInvId}/cancel`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('cancelled');
      expect(res.json().cancelled_at).toBeDefined();
    });

    it('should return 400 for unknown invoice', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/invoices/inv_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 10. Payment Links ──────────────────────────────────────────────────

  describe('Payment Links', () => {
    let plinkId: string;

    it('should create a payment link', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/payment_links',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          amount: 100000,
          currency: 'INR',
          description: 'Test payment link',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^plink_/);
      expect(body.entity).toBe('payment_link');
      expect(body.status).toBe('created');
      expect(body.amount).toBe(100000);
      expect(body.short_url).toBeTruthy();
      plinkId = body.id;
    });

    it('should get a payment link', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/payment_links/${plinkId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(plinkId);
    });

    it('should list payment links', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/payment_links',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should cancel a payment link', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/razorpay/v1/payment_links/${plinkId}/cancel`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('cancelled');
      expect(res.json().cancelled_at).toBeDefined();
    });

    it('should return 400 for missing amount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/payment_links',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ currency: 'INR' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for unknown payment link', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/payment_links/plink_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 11. Settlements ────────────────────────────────────────────────────

  describe('Settlements', () => {
    it('should list settlements (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/settlements',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
    });

    it('should get a seeded settlement', async () => {
      // Seed a settlement
      const settlement = {
        id: 'setl_TestSetl001',
        entity: 'settlement',
        amount: 500000,
        status: 'processed',
        fees: 5000,
        tax: 900,
        utr: 'UTR123456',
        created_at: Math.floor(Date.now() / 1000),
      };
      ts.stateStore.set('rzp_settlements', settlement.id, settlement);

      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/settlements/${settlement.id}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('setl_TestSetl001');
      expect(res.json().amount).toBe(500000);
    });

    it('should return 400 for unknown settlement', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/settlements/setl_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 12. Virtual Accounts ───────────────────────────────────────────────

  describe('Virtual Accounts', () => {
    let vaId: string;

    it('should create a virtual account', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/virtual_accounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Test VA',
          description: 'Virtual Account for testing',
          amount_expected: 500000,
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^va_/);
      expect(body.entity).toBe('virtual_account');
      expect(body.status).toBe('active');
      expect(body.name).toBe('Test VA');
      vaId = body.id;
    });

    it('should get a virtual account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/virtual_accounts/${vaId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(vaId);
    });

    it('should list virtual accounts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/virtual_accounts',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should return 400 for unknown virtual account', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/virtual_accounts/va_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 13. QR Codes ───────────────────────────────────────────────────────

  describe('QR Codes', () => {
    let qrId: string;

    it('should create a QR code', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/payments/qr_codes',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          name: 'Test QR',
          usage: 'single_use',
          type: 'upi_qr',
          payment_amount: 50000,
          fixed_amount: true,
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^qr_/);
      expect(body.entity).toBe('qr_code');
      expect(body.status).toBe('active');
      expect(body.image_url).toBeTruthy();
      qrId = body.id;
    });

    it('should get a QR code', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/payments/qr_codes/${qrId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(qrId);
    });

    it('should return 400 for unknown QR code', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/payments/qr_codes/qr_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 14. Fund Accounts ──────────────────────────────────────────────────

  describe('Fund Accounts', () => {
    let faId: string;

    it('should create a fund account', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/fund_accounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          contact_id: 'cont_TestContact',
          account_type: 'bank_account',
          bank_account: {
            name: 'Test Account',
            ifsc: 'HDFC0000001',
            account_number: '1234567890',
          },
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^fa_/);
      expect(body.entity).toBe('fund_account');
      expect(body.account_type).toBe('bank_account');
      expect(body.active).toBe(true);
      faId = body.id;
    });

    it('should list fund accounts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/fund_accounts',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/fund_accounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ contact_id: 'cont_Test' }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 15. Payouts ─────────────────────────────────────────────────────────

  describe('Payouts', () => {
    let payoutId: string;

    it('should create a payout', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/payouts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          account_number: '1234567890',
          fund_account_id: 'fa_TestFA001',
          amount: 100000,
          currency: 'INR',
          mode: 'IMPS',
          purpose: 'salary',
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^pout_/);
      expect(body.entity).toBe('payout');
      expect(body.status).toBe('processing');
      expect(body.amount).toBe(100000);
      expect(body.mode).toBe('IMPS');
      expect(body.fees).toBeDefined();
      expect(body.tax).toBeDefined();
      payoutId = body.id;
    });

    it('should get a payout', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/razorpay/v1/payouts/${payoutId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(payoutId);
    });

    it('should list payouts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/payouts',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entity).toBe('collection');
      expect(res.json().count).toBeGreaterThanOrEqual(1);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/razorpay/v1/payouts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 100000 }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for unknown payout', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/razorpay/v1/payouts/pout_UNKNOWN',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 16. resolvePersona ─────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Basic auth with rzp_test_ prefix', () => {
      const keyId = 'rzp_test_youngpro';
      const keySecret = 'some_secret';
      const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const mockReq = {
        headers: { authorization: `Basic ${token}` },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBe('youngpro');
    });

    it('should return null for non-matching key', () => {
      const token = Buffer.from('rzp_live_key:secret').toString('base64');
      const mockReq = {
        headers: { authorization: `Basic ${token}` },
      } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for missing auth header', () => {
      const mockReq = { headers: {} } as any;
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 17. Cross-surface seeding ──────────────────────────────────────────

  describe('cross-surface seeding', () => {
    it('should seed orders from apiResponses', async () => {
      const seededAdapter = new RazorpayAdapter();
      const seedData = new Map<string, ExpandedData>([
        [
          'test-persona',
          {
            persona: 'test' as any,
            blueprint: {} as any,
            tables: {},
            facts: [],
            apiResponses: {
              razorpay: {
                responses: {
                  orders: [
                    {
                      status: 200,
                      body: {
                        id: 'order_SeededOrder01',
                        entity: 'order',
                        amount: 75000,
                        currency: 'INR',
                        status: 'paid',
                        amount_paid: 75000,
                        amount_due: 0,
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      ]);

      const seededTs = await buildTestServer(seededAdapter, seedData);

      const res = await seededTs.server.inject({
        method: 'GET',
        url: '/razorpay/v1/orders/order_SeededOrder01',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('order_SeededOrder01');
      expect(res.json().amount).toBe(75000);
      expect(res.json().status).toBe('paid');

      await seededTs.close();
    });
  });
});
