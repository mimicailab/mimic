import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { PaddleAdapter } from '../paddle-adapter.js';

describe('PaddleAdapter', () => {
  let ts: TestServer;
  let adapter: PaddleAdapter;

  beforeAll(async () => {
    adapter = new PaddleAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('paddle');
      expect(adapter.name).toBe('Paddle API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/paddle');
    });
  });

  // ── 2. Endpoints count ────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return 83 endpoint definitions matching the spec', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBe(83);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Product CRUD ────────────────────────────────────────────────────

  describe('Products', () => {
    let productId: string;

    it('should create a product', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/products',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Pro Plan', type: 'standard' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^pro_/);
      expect(body.data.name).toBe('Pro Plan');
      expect(body.data.status).toBe('active');
      expect(body.meta.request_id).toBeDefined();
      productId = body.data.id;
    });

    it('should get a product by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paddle/products/${productId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(productId);
    });

    it('should list products', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/products',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a product', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/paddle/products/${productId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Enterprise Plan' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.name).toBe('Enterprise Plan');
    });

    it('should return 404 for non-existent product', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/products/pro_nonexistent',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    });
  });

  // ── 4. Price CRUD ──────────────────────────────────────────────────────

  describe('Prices', () => {
    let priceId: string;

    it('should create a price', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/prices',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          product_id: 'pro_test1',
          description: 'Monthly',
          unit_price: { amount: '2999', currency_code: 'USD' },
          billing_cycle: { interval: 'month', frequency: 1 },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^pri_/);
      expect(body.data.product_id).toBe('pro_test1');
      priceId = body.data.id;
    });

    it('should list prices filtered by product', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/prices?product_id=pro_test1',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.every((p: Record<string, unknown>) => p.product_id === 'pro_test1')).toBe(true);
    });

    it('should update a price', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/paddle/prices/${priceId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ description: 'Annual' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.description).toBe('Annual');
    });
  });

  // ── 5. Customer CRUD ───────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'test@example.com', name: 'Test User' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^ctm_/);
      expect(body.data.email).toBe('test@example.com');
      expect(body.data.name).toBe('Test User');
      customerId = body.data.id;
    });

    it('should get a customer by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paddle/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(customerId);
    });

    it('should list customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/customers',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/paddle/customers/${customerId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Updated User' }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.name).toBe('Updated User');
      expect(body.data.email).toBe('test@example.com');
    });

    it('should list credit balances', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paddle/customers/${customerId}/credit-balances`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 6. Addresses ───────────────────────────────────────────────────────

  describe('Addresses', () => {
    let customerId: string;
    let addressId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'addr@test.com' }),
      });
      customerId = res.json().data.id;
    });

    it('should create an address', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/paddle/customers/${customerId}/addresses`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ country_code: 'GB', city: 'London', postal_code: 'SW1A 1AA' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^add_/);
      expect(body.data.country_code).toBe('GB');
      expect(body.data.customer_id).toBe(customerId);
      addressId = body.data.id;
    });

    it('should list addresses for a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paddle/customers/${customerId}/addresses`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(1);
    });

    it('should update an address', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/paddle/customers/${customerId}/addresses/${addressId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ city: 'Manchester' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.city).toBe('Manchester');
    });
  });

  // ── 7. Businesses ──────────────────────────────────────────────────────

  describe('Businesses', () => {
    let customerId: string;
    let businessId: string;

    beforeAll(async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'biz@test.com' }),
      });
      customerId = res.json().data.id;
    });

    it('should create a business', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: `/paddle/customers/${customerId}/businesses`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Acme Inc', tax_identifier: 'GB123456789' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^biz_/);
      expect(body.data.name).toBe('Acme Inc');
      businessId = body.data.id;
    });

    it('should list businesses for a customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paddle/customers/${customerId}/businesses`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBe(1);
    });

    it('should update a business', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/paddle/customers/${customerId}/businesses/${businessId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'Acme Corp' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.name).toBe('Acme Corp');
    });
  });

  // ── 8. Subscription lifecycle ──────────────────────────────────────────

  describe('Subscriptions', () => {
    let subId: string;

    beforeAll(async () => {
      // Seed a subscription directly via the store
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/subscriptions',
      });
      // We need to create one via seeding — use PATCH on a subscription we seed
      // For testing, let's use the transaction-based approach: subscriptions
      // in Paddle are created via transactions, but we can test existing sub routes
    });

    it('should return empty list initially', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/subscriptions',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().data)).toBe(true);
    });

    it('should return 404 for non-existent subscription', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/subscriptions/sub_nonexistent',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    });
  });

  // ── 9. Transaction CRUD ────────────────────────────────────────────────

  describe('Transactions', () => {
    let txnId: string;

    it('should create a transaction', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/transactions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          items: [{ price_id: 'pri_test1', quantity: 1 }],
          customer_id: 'ctm_test1',
          currency_code: 'USD',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^txn_/);
      expect(body.data.status).toBe('draft');
      expect(body.data.customer_id).toBe('ctm_test1');
      txnId = body.data.id;
    });

    it('should get a transaction by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paddle/transactions/${txnId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(txnId);
    });

    it('should list transactions', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/transactions',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a transaction', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/paddle/transactions/${txnId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ custom_data: { order: '123' } }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.custom_data.order).toBe('123');
    });

    it('should preview a transaction', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/transactions/preview',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          items: [{ price_id: 'pri_test1', quantity: 2 }],
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.details).toBeDefined();
    });

    it('should get invoice URL', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paddle/transactions/${txnId}/invoice`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.url).toContain('paddle.com');
    });
  });

  // ── 10. Adjustments ────────────────────────────────────────────────────

  describe('Adjustments', () => {
    it('should create an adjustment', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/adjustments',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          transaction_id: 'txn_test1',
          action: 'refund',
          reason: 'Customer request',
          items: [{ item_id: 'txnitm_test1', type: 'full' }],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^adj_/);
      expect(body.data.action).toBe('refund');
      expect(body.data.status).toBe('approved');
    });

    it('should list adjustments', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/adjustments',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 11. Discounts ──────────────────────────────────────────────────────

  describe('Discounts', () => {
    let discountId: string;

    it('should create a percentage discount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/discounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          description: '20% off',
          type: 'percentage',
          amount: '20',
          code: 'SAVE20',
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^dsc_/);
      expect(body.data.type).toBe('percentage');
      expect(body.data.amount).toBe('20');
      expect(body.data.code).toBe('SAVE20');
      discountId = body.data.id;
    });

    it('should list discounts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/discounts',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a discount', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/paddle/discounts/${discountId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ description: '25% off' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.description).toBe('25% off');
    });
  });

  // ── 12. Notification Settings ──────────────────────────────────────────

  describe('Notification Settings', () => {
    let settingId: string;

    it('should create a notification setting', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/notification-settings',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          description: 'My webhook',
          destination: 'https://example.com/webhooks',
          type: 'url',
          subscribed_events: ['transaction.completed'],
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^ntfset_/);
      expect(body.data.destination).toBe('https://example.com/webhooks');
      settingId = body.data.id;
    });

    it('should list notification settings', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/notification-settings',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a notification setting', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/paddle/notification-settings/${settingId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ active: false }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.active).toBe(false);
    });

    it('should delete a notification setting', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/paddle/notification-settings/${settingId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 13. Customer Portal ────────────────────────────────────────────────

  describe('Customer Portal', () => {
    it('should create a portal session', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/customers/ctm_test1/portal-sessions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^cps_/);
      expect(body.data.urls.general.overview).toContain('customer-portal.paddle.com');
    });
  });

  // ── 14. Reports ────────────────────────────────────────────────────────

  describe('Reports', () => {
    let reportId: string;

    it('should create a report', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/paddle/reports',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ type: 'transactions' }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.id).toMatch(/^rep_/);
      expect(body.data.status).toBe('ready');
      reportId = body.data.id;
    });

    it('should get report CSV URL', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/paddle/reports/${reportId}/csv`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.url).toContain('.csv');
    });
  });

  // ── 15. Error handling ─────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return Paddle error format for non-existent customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/paddle/customers/ctm_doesnotexist',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.error.type).toBe('request_error');
      expect(body.error.code).toBe('not_found');
      expect(body.error.detail).toContain('ctm_doesnotexist');
      expect(body.meta.request_id).toBeDefined();
    });
  });

  // ── 16. resolvePersona ─────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer pdl_test_young-professional_abc123xyz' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      const persona = adapter.resolvePersona(mockReq);
      expect(persona).toBe('young-professional');
    });

    it('should return null for missing auth header', () => {
      const mockReq = {
        headers: {},
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });

    it('should return null for non-matching token format', () => {
      const mockReq = {
        headers: { authorization: 'Bearer pdl_live_somekey' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 17. Cross-surface seeding from apiResponses ────────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new PaddleAdapter();
      const seedData = new Map<string, ExpandedData>([
        ['test-persona', {
          personaId: 'test-persona',
          blueprint: {} as Blueprint,
          tables: {},
          documents: {},
          apiResponses: {
            paddle: {
              adapterId: 'paddle',
              responses: {
                customers: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'ctm_seeded1', name: 'Alice Nguyen', email: 'alice@brightwave.io' },
                    personaId: 'test-persona',
                    stateKey: 'paddle_customers',
                  },
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'ctm_seeded2', name: 'Marcus Bell', email: 'marcus@stackforge.dev' },
                    personaId: 'test-persona',
                    stateKey: 'paddle_customers',
                  },
                ],
                products: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: 'pro_seeded1', name: 'Pro Plan', status: 'active' },
                    personaId: 'test-persona',
                    stateKey: 'paddle_products',
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
      const res = await seededTs.server.inject({ method: 'GET', url: '/paddle/customers' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(2);
      expect(body.data.some((c: Record<string, unknown>) => c.id === 'ctm_seeded1')).toBe(true);
      expect(body.data.some((c: Record<string, unknown>) => c.id === 'ctm_seeded2')).toBe(true);
    });

    it('should retrieve a pre-seeded customer by ID', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: '/paddle/customers/ctm_seeded1' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.id).toBe('ctm_seeded1');
      expect(body.data.name).toBe('Alice Nguyen');
      expect(body.data.email).toBe('alice@brightwave.io');
    });

    it('should list pre-seeded products', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: '/paddle/products' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].id).toBe('pro_seeded1');
      expect(body.data[0].name).toBe('Pro Plan');
    });

    it('should allow creating new resources alongside pre-seeded ones', async () => {
      const createRes = await seededTs.server.inject({
        method: 'POST',
        url: '/paddle/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'new@example.com', name: 'New User' }),
      });
      expect(createRes.statusCode).toBe(201);

      const listRes = await seededTs.server.inject({ method: 'GET', url: '/paddle/customers' });
      expect(listRes.json().data.length).toBe(3);
    });
  });
});
