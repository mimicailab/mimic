import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer, type TestServer } from '@mimicai/adapter-sdk';
import type { ExpandedData, Blueprint } from '@mimicai/core';
import { LemonSqueezyAdapter } from '../lemonsqueezy-adapter.js';

describe('LemonSqueezyAdapter', () => {
  let ts: TestServer;
  let adapter: LemonSqueezyAdapter;

  beforeAll(async () => {
    adapter = new LemonSqueezyAdapter();
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── 1. Adapter metadata ────────────────────────────────────────────────

  describe('metadata', () => {
    it('should have correct id, name, type, and basePath', () => {
      expect(adapter.id).toBe('lemonsqueezy');
      expect(adapter.name).toBe('Lemon Squeezy API');
      expect(adapter.type).toBe('api-mock');
      expect(adapter.basePath).toBe('/lemonsqueezy/v1');
    });
  });

  // ── 2. Endpoints count ────────────────────────────────────────────────

  describe('getEndpoints', () => {
    it('should return endpoint definitions matching the spec', () => {
      const endpoints = adapter.getEndpoints();
      expect(endpoints.length).toBeGreaterThanOrEqual(45);
      for (const ep of endpoints) {
        expect(ep.method).toBeDefined();
        expect(ep.path).toBeDefined();
        expect(ep.description).toBeDefined();
      }
    });
  });

  // ── 3. Users ──────────────────────────────────────────────────────────

  describe('Users', () => {
    it('should get authenticated user', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/users/me',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.type).toBe('users');
      expect(body.data.attributes.email).toBe('test@example.com');
      expect(body.jsonapi.version).toBe('1.0');
    });
  });

  // ── 4. Stores ─────────────────────────────────────────────────────────

  describe('Stores', () => {
    it('should list stores (auto-generates default)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/stores',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].type).toBe('stores');
      expect(body.data[0].attributes.name).toBe('Test Store');
      expect(body.meta).toBeDefined();
    });
  });

  // ── 5. Customers CRUD ─────────────────────────────────────────────────

  describe('Customers', () => {
    let customerId: string;

    it('should create a customer', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/lemonsqueezy/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { type: 'customers', attributes: { name: 'Alice Nguyen', email: 'alice@example.com' } },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.type).toBe('customers');
      expect(body.data.id).toBeDefined();
      expect(body.data.attributes.name).toBe('Alice Nguyen');
      expect(body.data.attributes.email).toBe('alice@example.com');
      customerId = body.data.id;
    });

    it('should get a customer by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/lemonsqueezy/v1/customers/${customerId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(customerId);
    });

    it('should list customers', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/customers',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a customer', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/lemonsqueezy/v1/customers/${customerId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { type: 'customers', id: customerId, attributes: { name: 'Alicia Nguyen' } },
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.attributes.name).toBe('Alicia Nguyen');
    });

    it('should return 404 for non-existent customer', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/customers/999999',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().errors[0].status).toBe('404');
    });
  });

  // ── 6. Discounts CRUD ─────────────────────────────────────────────────

  describe('Discounts', () => {
    let discountId: string;

    it('should create a discount', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/lemonsqueezy/v1/discounts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { type: 'discounts', attributes: { name: '20% Off', code: 'SAVE20', amount: 20, amount_type: 'percent' } },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.type).toBe('discounts');
      expect(body.data.attributes.code).toBe('SAVE20');
      expect(body.data.attributes.amount).toBe(20);
      discountId = body.data.id;
    });

    it('should list discounts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/discounts',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should get a discount by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/lemonsqueezy/v1/discounts/${discountId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(discountId);
    });

    it('should delete a discount', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/lemonsqueezy/v1/discounts/${discountId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 7. Checkouts ──────────────────────────────────────────────────────

  describe('Checkouts', () => {
    let checkoutId: string;

    it('should create a checkout', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/lemonsqueezy/v1/checkouts',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: { custom_price: 1999 },
            relationships: {
              store: { data: { type: 'stores', id: '1' } },
              variant: { data: { type: 'variants', id: '1' } },
            },
          },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.type).toBe('checkouts');
      expect(body.data.attributes.url).toContain('lemonsqueezy.com');
      checkoutId = body.data.id;
    });

    it('should list checkouts', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/checkouts',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should get a checkout by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/lemonsqueezy/v1/checkouts/${checkoutId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(checkoutId);
    });
  });

  // ── 8. Webhooks CRUD ──────────────────────────────────────────────────

  describe('Webhooks', () => {
    let webhookId: string;

    it('should create a webhook', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/lemonsqueezy/v1/webhooks',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { type: 'webhooks', attributes: { url: 'https://example.com/wh', events: ['order_created'], secret: 'mysecret' } },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.type).toBe('webhooks');
      expect(body.data.attributes.url).toBe('https://example.com/wh');
      webhookId = body.data.id;
    });

    it('should list webhooks', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/webhooks',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should update a webhook', async () => {
      const res = await ts.server.inject({
        method: 'PATCH',
        url: `/lemonsqueezy/v1/webhooks/${webhookId}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { type: 'webhooks', id: webhookId, attributes: { url: 'https://example.com/wh2' } },
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.attributes.url).toBe('https://example.com/wh2');
    });

    it('should delete a webhook', async () => {
      const res = await ts.server.inject({
        method: 'DELETE',
        url: `/lemonsqueezy/v1/webhooks/${webhookId}`,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── 9. Usage Records ──────────────────────────────────────────────────

  describe('Usage Records', () => {
    let recordId: string;

    it('should create a usage record', async () => {
      const res = await ts.server.inject({
        method: 'POST',
        url: '/lemonsqueezy/v1/usage-records',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { type: 'usage-records', attributes: { subscription_item_id: '1', quantity: 5, action: 'increment' } },
        }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.type).toBe('usage-records');
      expect(body.data.attributes.quantity).toBe(5);
      recordId = body.data.id;
    });

    it('should list usage records', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/usage-records',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    });

    it('should get a usage record by id', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: `/lemonsqueezy/v1/usage-records/${recordId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(recordId);
    });
  });

  // ── 10. Orders ────────────────────────────────────────────────────────

  describe('Orders', () => {
    it('should list orders (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/orders',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().data)).toBe(true);
    });

    it('should return 404 for non-existent order', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/orders/999999',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── 11. Subscriptions ─────────────────────────────────────────────────

  describe('Subscriptions', () => {
    it('should list subscriptions (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/subscriptions',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().data)).toBe(true);
    });
  });

  // ── 12. License Keys ──────────────────────────────────────────────────

  describe('License Keys', () => {
    it('should list license keys (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/license-keys',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().data)).toBe(true);
    });
  });

  // ── 13. Files ─────────────────────────────────────────────────────────

  describe('Files', () => {
    it('should list files (empty initially)', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/files',
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().data)).toBe(true);
    });
  });

  // ── 14. JSON:API format ───────────────────────────────────────────────

  describe('JSON:API format', () => {
    it('should return proper JSON:API structure for single resources', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/users/me',
      });
      const body = res.json();
      expect(body.jsonapi).toEqual({ version: '1.0' });
      expect(body.data.type).toBeDefined();
      expect(body.data.id).toBeDefined();
      expect(body.data.attributes).toBeDefined();
      expect(body.links.self).toContain('lemonsqueezy.com');
    });

    it('should return proper JSON:API structure for list resources', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/stores',
      });
      const body = res.json();
      expect(body.jsonapi).toEqual({ version: '1.0' });
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta.page).toBeDefined();
      expect(body.links).toBeDefined();
    });
  });

  // ── 15. Error handling ────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should return JSON:API error format', async () => {
      const res = await ts.server.inject({
        method: 'GET',
        url: '/lemonsqueezy/v1/products/999999',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.errors).toBeDefined();
      expect(body.errors[0].status).toBe('404');
      expect(body.errors[0].title).toBe('Not Found');
      expect(body.errors[0].detail).toContain('999999');
    });
  });

  // ── 16. resolvePersona ────────────────────────────────────────────────

  describe('resolvePersona', () => {
    it('should extract persona from Bearer token', () => {
      const mockReq = {
        headers: { authorization: 'Bearer test_young-professional_abc123xyz' },
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
        headers: { authorization: 'Bearer live_somekey' },
      } as unknown as Parameters<typeof adapter.resolvePersona>[0];
      expect(adapter.resolvePersona(mockReq)).toBeNull();
    });
  });

  // ── 17. Cross-surface seeding from apiResponses ───────────────────────

  describe('Cross-surface seeding', () => {
    let seededTs: TestServer;

    beforeAll(async () => {
      const seededAdapter = new LemonSqueezyAdapter();
      const seedData = new Map<string, ExpandedData>([
        ['test-persona', {
          personaId: 'test-persona',
          blueprint: {} as Blueprint,
          tables: {},
          documents: {},
          apiResponses: {
            lemonsqueezy: {
              adapterId: 'lemonsqueezy',
              responses: {
                customers: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: '5001', name: 'Alice Nguyen', email: 'alice@brightwave.io', status: 'subscribed' },
                    personaId: 'test-persona',
                    stateKey: 'ls_customers',
                  },
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: '5002', name: 'Marcus Bell', email: 'marcus@stackforge.dev', status: 'subscribed' },
                    personaId: 'test-persona',
                    stateKey: 'ls_customers',
                  },
                ],
                products: [
                  {
                    statusCode: 200,
                    headers: {},
                    body: { id: '100', name: 'Pro Plan', status: 'published', store_id: 1 },
                    personaId: 'test-persona',
                    stateKey: 'ls_products',
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
      const res = await seededTs.server.inject({ method: 'GET', url: '/lemonsqueezy/v1/customers' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(2);
      expect(body.data.some((c: Record<string, unknown>) => c.id === '5001')).toBe(true);
      expect(body.data.some((c: Record<string, unknown>) => c.id === '5002')).toBe(true);
    });

    it('should retrieve a pre-seeded customer by ID', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: '/lemonsqueezy/v1/customers/5001' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.id).toBe('5001');
      expect(body.data.attributes.name).toBe('Alice Nguyen');
    });

    it('should list pre-seeded products', async () => {
      const res = await seededTs.server.inject({ method: 'GET', url: '/lemonsqueezy/v1/products' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].attributes.name).toBe('Pro Plan');
    });

    it('should allow creating new resources alongside pre-seeded ones', async () => {
      const createRes = await seededTs.server.inject({
        method: 'POST',
        url: '/lemonsqueezy/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          data: { type: 'customers', attributes: { name: 'New User', email: 'new@example.com' } },
        }),
      });
      expect(createRes.statusCode).toBe(201);

      const listRes = await seededTs.server.inject({ method: 'GET', url: '/lemonsqueezy/v1/customers' });
      expect(listRes.json().data.length).toBe(3);
    });
  });
});
