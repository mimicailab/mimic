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
      expect(adapter.basePath).toBe('/stripe/v1');
    });
  });

  // ── 2. Endpoints count ────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return the correct number of endpoint definitions', () => {
      const endpoints = adapter.getEndpoints();
      // 5 customer + 5 PI + 2 charges + 5 subscriptions + 4 invoices
      // + 2 refunds + 2 products + 2 prices + 1 balance + 1 events = 29
      expect(endpoints.length).toBe(29);
      // Verify every endpoint has required fields
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
      // Get the PI to find the charge id
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
      // Create
      const createRes = await ts.server.inject({
        method: 'POST',
        url: '/stripe/v1/payment_intents',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ amount: 3000, currency: 'usd' }),
      });
      const piId = createRes.json().id;

      // Cancel
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

  // ── 8. Invoice create -> pay ──────────────────────────────────────────

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

  // ── 9. Refund creation ────────────────────────────────────────────────

  describe('Refunds', () => {
    it('should create a refund', async () => {
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
  });

  // ── 10. Product and price creation ────────────────────────────────────

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

  // ── 11. Balance retrieval ─────────────────────────────────────────────

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

  // ── 12. 404 for non-existent customer ─────────────────────────────────

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

  // ── 13. resolvePersona ────────────────────────────────────────────────

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

  // ── 14. Cross-surface seeding from apiResponses ────────────────────────

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
      // Create a new customer
      const createRes = await seededTs.server.inject({
        method: 'POST',
        url: '/stripe/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'new@example.com', name: 'New User' }),
      });
      expect(createRes.statusCode).toBe(200);

      // List should now have 3 customers (2 seeded + 1 new)
      const listRes = await seededTs.server.inject({ method: 'GET', url: '/stripe/v1/customers' });
      expect(listRes.json().data.length).toBe(3);
    });
  });
});
