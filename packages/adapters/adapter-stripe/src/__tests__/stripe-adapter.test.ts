import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { StripeAdapter } from '../stripe-adapter.js';

describe('StripeAdapter', () => {
  let ts: TestServer;
  let adapter: StripeAdapter;

  beforeAll(async () => {
    adapter = new StripeAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('stripe');
      expect(adapter.name).toBe('Stripe API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/stripe');
    });
  });

  // ── 2. Endpoints count ────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return the correct number of endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      // v1 (587) + v2 (29 — billing meter events, core accounts, event destinations)
      expect(endpoints.length).toBe(616);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Customer CRUD ──────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'test@example.com', name: 'Test User' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('customer');
      expect(body.id).toMatch(/^cus_/);
      expect(body.email).toBe('test@example.com');
      expect(body.name).toBe('Test User');
      customerId = body.id;
    });

    it('should get a customer by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/stripe/v1/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(customerId);
      expect(body.email).toBe('test@example.com');
    });

    it('should list customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/stripe/v1/customers',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('list');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.url).toBe('/v1/customers');
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/customers/${customerId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Updated User' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(customerId);
      expect(body.name).toBe('Updated User');
      expect(body.email).toBe('test@example.com'); // unchanged
    });

    it('should delete a customer', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/stripe/v1/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(customerId);
      expect(body.object).toBe('customer');
      expect(body.deleted).toBe(true);
    });
  });

  // ── 4. PI lifecycle: create -> confirm -> succeeded ───────────────────

  describe('Payment Intent lifecycle', () => {
    let piId: string;

    it('should create a payment intent', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/payment_intents',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 5000, currency: 'usd' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^pi_/);
      expect(body.status).toBe('requires_payment_method');
      expect(body.amount).toBe(5000);
      expect(body.client_secret).toBeDefined();
      piId = body.id;
    });

    it('should list payment intents', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/stripe/v1/payment_intents',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('list');
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should confirm a payment intent and create a charge', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_intents/${piId}/confirm`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('succeeded');
      expect(body.latest_charge).toMatch(/^ch_/);
    });

    it('should retrieve the charge created by confirm', async () => {
      const piRes = await ts.server.inject({
        method: 'GET',
        url: `/stripe/v1/payment_intents/${piId}`,
      });
      const chargeId = piRes.json().latest_charge;

      const res = await ts.server.inject({
        method: 'GET',
        url: `/stripe/v1/charges/${chargeId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('charge');
      expect(body.payment_intent).toBe(piId);
      expect(body.amount).toBe(5000);
    });
  });

  // ── 5. PI capture flow ────────────────────────────────────────────────

  describe('Payment Intent capture flow', () => {
    let piId: string;

    it('should create a PI with manual capture', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/payment_intents',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 10000, currency: 'usd' }),
      });
      expect(res.statusCode).toBe(200);
      piId = res.json().id;
    });

    it('should confirm with capture_method=manual and get requires_capture', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_intents/${piId}/confirm`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ capture_method: 'manual' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('requires_capture');
      expect(body.latest_charge).toMatch(/^ch_/);
    });

    it('should capture and transition to succeeded', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_intents/${piId}/capture`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('succeeded');
      expect(body.amount_captured).toBe(10000);
    });
  });

  // ── 6. PI cancel ──────────────────────────────────────────────────────

  describe('Payment Intent cancel', () => {
    it('should cancel a payment intent', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/payment_intents',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 3000, currency: 'usd' }),
      });
      const piId = createRes.json().id;

      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_intents/${piId}/cancel`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('canceled');
    });
  });

  // ── 7. Subscription lifecycle ─────────────────────────────────────────

  describe('Subscriptions', () => {
    let subId: string;
    const customerId = 'cus_testsubcustomer';

    it('should create a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/subscriptions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          customer: customerId,
          items: [{ price: 'price_abc123' }],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^sub_/);
      expect(body.status).toBe('active');
      expect(body.customer).toBe(customerId);
      expect(body.items.object).toBe('list');
      expect(body.items.data.length).toBe(1);
      expect(body.items.data[0].id).toMatch(/^si_/);
      subId = body.id;
    });

    it('should list subscriptions filtered by customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/stripe/v1/subscriptions?customer=${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('list');
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.every((s: Record<string, unknown>) => s.customer === customerId)).toBe(true);
    });

    it('should update a subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/subscriptions/${subId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ cancel_at_period_end: true }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(subId);
      expect(body.cancel_at_period_end).toBe(true);
    });

    it('should cancel (DELETE) a subscription', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/stripe/v1/subscriptions/${subId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(subId);
      expect(body.status).toBe('canceled');
    });
  });

  // ── 8. Invoice lifecycle: create -> finalize -> pay ───────────────────

  describe('Invoices', () => {
    let invoiceId: string;

    it('should create an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/invoices',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer: 'cus_inv1', amount_due: 2500 }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^in_/);
      expect(body.object).toBe('invoice');
      expect(body.status).toBe('draft');
      invoiceId = body.id;
    });

    it('should finalize an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/invoices/${invoiceId}/finalize`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(invoiceId);
      expect(body.status).toBe('open');
    });

    it('should pay an invoice', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/invoices/${invoiceId}/pay`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(invoiceId);
      expect(body.status).toBe('paid');
    });
  });

  // ── 9. Invoice Items ──────────────────────────────────────────────────

  describe('Invoice Items', () => {
    it('should create an invoice item', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/invoiceitems',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer: 'cus_test1', amount: 1500, description: 'Setup fee' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^ii_/);
      expect(body.object).toBe('invoiceitem');
      expect(body.amount).toBe(1500);
      expect(body.description).toBe('Setup fee');
    });
  });

  // ── 10. Refund creation and charge sync ──────────────────────────────

  describe('Refunds', () => {
    it('should create a refund (no linked charge)', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/refunds',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 1000, charge: 'ch_test123' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^re_/);
      expect(body.object).toBe('refund');
      expect(body.status).toBe('succeeded');
      expect(body.amount).toBe(1000);
    });

    it('should sync charge.amount_refunded when creating a refund', async () => {
      // Create a charge via PI confirm
      const piRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/payment_intents',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 5000, currency: 'usd' }),
      });
      const piId = piRes.json().id;

      await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_intents/${piId}/confirm`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });

      const chargeId = (await ts.server.inject({ method: 'GET', url: `/stripe/v1/payment_intents/${piId}` }))
        .json().latest_charge;

      // Create a partial refund
      const refundRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/refunds',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 2000, charge: chargeId }),
      });
      expect(refundRes.statusCode).toBe(200);
      expect(refundRes.json().charge).toBe(chargeId);

      // Charge should reflect the refund
      const chargeRes = await ts.server.inject({ method: 'GET', url: `/stripe/v1/charges/${chargeId}` });
      const charge = chargeRes.json();
      expect(charge.amount_refunded).toBe(2000);
      expect(charge.refunded).toBe(false); // partial refund, not fully refunded
    });

    it('should set charge.refunded=true on full refund', async () => {
      const piRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/payment_intents',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 3000, currency: 'usd' }),
      });
      const piId = piRes.json().id;
      await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_intents/${piId}/confirm`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      const chargeId = (await ts.server.inject({ method: 'GET', url: `/stripe/v1/payment_intents/${piId}` }))
        .json().latest_charge;

      await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/refunds',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 3000, charge: chargeId }),
      });

      const chargeRes = await ts.server.inject({ method: 'GET', url: `/stripe/v1/charges/${chargeId}` });
      const charge = chargeRes.json();
      expect(charge.amount_refunded).toBe(3000);
      expect(charge.refunded).toBe(true);
    });

    it('should reflect refunds in GET /balance', async () => {
      const balanceBefore = (await ts.server.inject({ method: 'GET', url: '/stripe/v1/balance' }))
        .json().available[0].amount;

      const piRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/payment_intents',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 4000, currency: 'usd' }),
      });
      const piId = piRes.json().id;
      await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_intents/${piId}/confirm`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      const chargeId = (await ts.server.inject({ method: 'GET', url: `/stripe/v1/payment_intents/${piId}` }))
        .json().latest_charge;

      const balanceAfterCharge = (await ts.server.inject({ method: 'GET', url: '/stripe/v1/balance' }))
        .json().available[0].amount;
      expect(balanceAfterCharge).toBe(balanceBefore + 4000);

      await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/refunds',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 4000, charge: chargeId }),
      });

      const balanceAfterRefund = (await ts.server.inject({ method: 'GET', url: '/stripe/v1/balance' }))
        .json().available[0].amount;
      expect(balanceAfterRefund).toBe(balanceBefore);
    });
  });

  // ── 11. Product and price creation ────────────────────────────────────

  describe('Products & Prices', () => {
    it('should create a product', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/products',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Premium Plan' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^prod_/);
      expect(body.object).toBe('product');
      expect(body.name).toBe('Premium Plan');
    });

    it('should create a price', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/prices',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ unit_amount: 2999, currency: 'usd', product: 'prod_abc' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^price_/);
      expect(body.object).toBe('price');
      expect(body.unit_amount).toBe(2999);
    });
  });

  // ── 12. Coupons CRUD ──────────────────────────────────────────────────

  describe('Coupons', () => {
    let couponId: string;

    it('should create a percentage coupon', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/coupons',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ percent_off: 25, duration: 'once' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('coupon');
      expect(body.percent_off).toBe(25);
      expect(body.duration).toBe('once');
      expect(body.valid).toBe(true);
      couponId = body.id;
    });

    it('should create a fixed-amount coupon', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/coupons',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount_off: 500, currency: 'usd', duration: 'forever' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.amount_off).toBe(500);
      expect(body.currency).toBe('usd');
    });

    it('should list coupons', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/stripe/v1/coupons',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('list');
      expect(body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should get a coupon by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/stripe/v1/coupons/${couponId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(couponId);
    });

    it('should delete a coupon', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/stripe/v1/coupons/${couponId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.deleted).toBe(true);
    });
  });

  // ── 13. Disputes ──────────────────────────────────────────────────────

  describe('Disputes', () => {
    it('should list disputes (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/stripe/v1/disputes',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('list');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('should return 404 for non-existent dispute', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/stripe/v1/disputes/dp_nonexistent',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('resource_missing');
    });
  });

  // ── 14. Payment Links ─────────────────────────────────────────────────

  describe('Payment Links', () => {
    it('should create a payment link', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/payment_links',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          line_items: [{ price: 'price_abc', quantity: 1 }],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^plink_/);
      expect(body.object).toBe('payment_link');
      expect(body.active).toBe(true);
      expect(body.url).toContain('buy.stripe.com');
    });

    it('should list payment links', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/stripe/v1/payment_links',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('list');
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 15. Billing Portal ────────────────────────────────────────────────

  describe('Billing Portal', () => {
    it('should create a billing portal session', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/billing_portal/sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer: 'cus_test1', return_url: 'https://example.com' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^bps_/);
      expect(body.object).toBe('billing_portal.session');
      expect(body.customer).toBe('cus_test1');
      expect(body.url).toContain('billing.stripe.com');
      expect(body.return_url).toBe('https://example.com');
    });
  });

  // ── 16. Account ───────────────────────────────────────────────────────

  describe('Account', () => {
    it('should return account info', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/stripe/v1/account',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('account');
      expect(body.charges_enabled).toBe(true);
      expect(body.payouts_enabled).toBe(true);
      expect(body.country).toBe('US');
    });
  });

  // ── 17. Balance ───────────────────────────────────────────────────────

  describe('Balance', () => {
    it('should return a balance object', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/stripe/v1/balance',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.object).toBe('balance');
      expect(Array.isArray(body.available)).toBe(true);
      expect(Array.isArray(body.pending)).toBe(true);
    });
  });

  // ── 18. Error handling ────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return Stripe error format for non-existent customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/stripe/v1/customers/cus_doesnotexist',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.error.type).toBe('invalid_request_error');
      expect(body.error.code).toBe('resource_missing');
      expect(body.error.param).toBeNull();
      expect(body.error.message).toContain('cus_doesnotexist');
    });
  });

  // ── 19. resolvePersona ────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer sk_test_young-professional_abc123xyz' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      const persona = adapter.resolvePersona(mockReq);
      expect(persona).toBe('young-professional');
    });

    it('should return null for missing auth header', () => {
      const mockReq = {
        headers: {},
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      const persona = adapter.resolvePersona(mockReq);
      expect(persona).toBeNull();
    });

    it('should return null for non-matching token format', () => {
      const mockReq = {
        headers: { authorization: 'Bearer sk_live_somekey' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      const persona = adapter.resolvePersona(mockReq);
      expect(persona).toBeNull();
    });
  });

  // ── 20. Payment Method attach/detach ─────────────────────────────────

  describe('PaymentMethod attach/detach', () => {
    let pmId: string;

    it('should create a payment method', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/payment_methods',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 'card' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^pm_/);
      expect(body.customer).toBeNull();
      pmId = body.id;
    });

    it('should attach a payment method to a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_methods/${pmId}/attach`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer: 'cus_attach_test' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(pmId); // same PM, not a new object
      expect(body.customer).toBe('cus_attach_test');
    });

    it('should retrieve the same PM with updated customer field', async () => {
      const res = await ts.server.inject({ method: 'GET', url: `/stripe/v1/payment_methods/${pmId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().customer).toBe('cus_attach_test');
    });

    it('should detach a payment method from a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_methods/${pmId}/detach`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(pmId);
      expect(body.customer).toBeNull();
    });

    it('should return 400 when detaching an already-detached payment method', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/payment_methods/${pmId}/detach`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('payment_method_not_attached');
    });
  });

  // ── 21. Customer delete cascade ───────────────────────────────────────

  describe('Customer delete cascade', () => {
    it('should cancel subscriptions when customer is deleted', async () => {
      // Create a customer
      const cusRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'cascade@test.com' }),
      });
      const cusId = cusRes.json().id;

      // Create a subscription for that customer
      const subRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/subscriptions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer: cusId, items: [{ price: 'price_cascade' }] }),
      });
      const subId = subRes.json().id;
      expect(subRes.json().status).toBe('active');

      // Delete the customer
      const delRes = await ts.server.inject({
        method: 'DELETE',
        url: `/stripe/v1/customers/${cusId}`,
      });
      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().deleted).toBe(true);

      // Customer should be gone
      const cusCheck = await ts.server.inject({ method: 'GET', url: `/stripe/v1/customers/${cusId}` });
      expect(cusCheck.statusCode).toBe(404);

      // Subscription should be canceled
      const subCheck = await ts.server.inject({ method: 'GET', url: `/stripe/v1/subscriptions/${subId}` });
      expect(subCheck.statusCode).toBe(200);
      expect(subCheck.json().status).toBe('canceled');
    });
  });

  // ── 22. Invoice delete (draft only) ──────────────────────────────────

  describe('Invoice delete', () => {
    it('should delete a draft invoice', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/invoices',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer: 'cus_del_test', amount_due: 500 }),
      });
      const invId = createRes.json().id;
      expect(createRes.json().status).toBe('draft');

      const delRes = await ts.server.inject({
        method: 'DELETE',
        url: `/stripe/v1/invoices/${invId}`,
      });
      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().deleted).toBe(true);

      const check = await ts.server.inject({ method: 'GET', url: `/stripe/v1/invoices/${invId}` });
      expect(check.statusCode).toBe(404);
    });

    it('should reject deleting an open invoice', async () => {
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/invoices',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ customer: 'cus_del_test2', amount_due: 800 }),
      });
      const invId = createRes.json().id;

      await ts.server.inject({
        method: 'POST',
        url: `/stripe/v1/invoices/${invId}/finalize`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });

      const delRes = await ts.server.inject({
        method: 'DELETE',
        url: `/stripe/v1/invoices/${invId}`,
      });
      expect(delRes.statusCode).toBe(400);
      expect(delRes.json().error.code).toBe('invoice_not_editable');
    });
  });

  // ── 23. Subscription items sync ───────────────────────────────────────

  describe('Subscription items', () => {
    let subId: string;
    let itemId: string;

    it('should create a subscription with one item', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/subscriptions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          customer: 'cus_si_test',
          items: [{ price: 'price_base' }],
        }),
      });
      expect(res.statusCode).toBe(200);
      subId = res.json().id;
      expect(res.json().items.data.length).toBe(1);
    });

    it('should add a subscription item and update parent subscription', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/subscription_items',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ subscription: subId, price: 'price_addon', quantity: 2 }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^si_/);
      expect(body.subscription).toBe(subId);
      expect(body.quantity).toBe(2);
      itemId = body.id;

      // Parent subscription should now have 2 items
      const subRes = await ts.server.inject({ method: 'GET', url: `/stripe/v1/subscriptions/${subId}` });
      expect(subRes.json().items.data.length).toBe(2);
    });

    it('should delete a subscription item and update parent subscription', async () => {
      const delRes = await ts.server.inject({
        method: 'DELETE',
        url: `/stripe/v1/subscription_items/${itemId}`,
      });
      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().deleted).toBe(true);

      // Parent subscription should be back to 1 item
      const subRes = await ts.server.inject({ method: 'GET', url: `/stripe/v1/subscriptions/${subId}` });
      expect(subRes.json().items.data.length).toBe(1);
      expect(subRes.json().items.data.some((i: Record<string, unknown>) => i.id === itemId)).toBe(false);
    });
  });

  // ── 24. Cross-surface seeding from apiResponses ────────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new StripeAdapter();
      const seedData = new Map<string, ExpandedData>([
        ['test-persona', {
          personaId: 'test-persona',
          blueprint: {} as Blueprint,
          tables: {},
          documents: {},
          apiResponses: {
            stripe: {
              adapterId: 'stripe',
              responses: {
                customers: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'cus_seeded1', name: 'Alice Nguyen', email: 'alice@brightwave.io' },
                    personaId: 'test-persona',
                    stateKey: 'stripe_customers',
                  },
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'cus_seeded2', name: 'Marcus Bell', email: 'marcus@stackforge.dev' },
                    personaId: 'test-persona',
                    stateKey: 'stripe_customers',
                  },
                ],
                subscriptions: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'sub_seeded1', customer: 'cus_seeded1', status: 'active' },
                    personaId: 'test-persona',
                    stateKey: 'stripe_subs',
                  },
                ],
              },
            },
          },
          files: [],
          events: [],
      facts: [],
        }],
      ]);
      seededTs = await buildTestServer(seededAdapter, seedData);
    });

    afterAll(async () => {
      await seededTs.close();
    });

    it('should list pre-seeded customers', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: '/stripe/v1/customers' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(2);
      expect(body.data.some((c: Record<string, unknown>) => c.id === 'cus_seeded1')).toBe(true);
      expect(body.data.some((c: Record<string, unknown>) => c.id === 'cus_seeded2')).toBe(true);
    });

    it('should retrieve a pre-seeded customer by ID', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: '/stripe/v1/customers/cus_seeded1' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('cus_seeded1');
      expect(body.name).toBe('Alice Nguyen');
      expect(body.email).toBe('alice@brightwave.io');
      expect(body.object).toBe('customer');
      expect(body.livemode).toBe(false);
    });

    it('should list pre-seeded subscriptions filtered by customer', async () => {
      const res = await seededTs.server.inject({
        method: 'GET',
        url: '/stripe/v1/subscriptions?customer=cus_seeded1',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].id).toBe('sub_seeded1');
      expect(body.data[0].status).toBe('active');
    });

    it('should allow creating new resources alongside pre-seeded ones', async () => {
      const createRes = await seededTs.server.inject({
        method: 'POST',
        url: '/stripe/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'new@example.com', name: 'New User' }),
      });
      expect(createRes.statusCode).toBe(200);

      const listRes = await seededTs.server.inject({ method: 'GET', url: '/stripe/v1/customers' });
      expect(listRes.json().data.length).toBe(3);
    });
  });
});
