import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import { LemonSqueezyAdapter } from '../lemonsqueezy-adapter.js';

describe('LemonSqueezyAdapter', () => {
  let ts: TestServer;
  const adapter = new LemonSqueezyAdapter();

  beforeAll(async () => {
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── Metadata ────────────────────────────────────────────────────────────

  it('should have correct metadata', () => {
    expect(adapter.id).toBe('lemonsqueezy');
    expect(adapter.basePath).toBe('/lemonsqueezy');
    expect(adapter.name).toBe('Lemon Squeezy');
  });

  it('should return endpoint definitions', () => {
    const endpoints = adapter.getEndpoints();
    expect(endpoints.length).toBeGreaterThan(30);
    for (const ep of endpoints) {
      expect(ep.method).toBeDefined();
      expect(ep.path).toBeDefined();
    }
  });

  // ── Customers CRUD ──────────────────────────────────────────────────────

  it('should create a customer (JSON:API format)', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/lemonsqueezy/v1/customers',
      headers: { 'content-type': 'application/vnd.api+json' },
      payload: JSON.stringify({
        data: {
          type: 'customers',
          attributes: { name: 'Jane Doe', email: 'jane@example.com' },
          relationships: { store: { data: { type: 'stores', id: '1' } } },
        },
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.type).toBe('customers');
    expect(body.data.attributes.name).toBe('Jane Doe');
    expect(body.data.attributes.email).toBe('jane@example.com');
    expect(body.data.id).toBeDefined();
    expect(body.jsonapi.version).toBe('1.0');
  });

  it('should create a customer (plain body)', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/lemonsqueezy/v1/customers',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'John Smith', email: 'john@example.com' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.attributes.name).toBe('John Smith');
  });

  it('should list customers', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/lemonsqueezy/v1/customers',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.meta.page).toBeDefined();
    expect(body.meta.page.currentPage).toBe(1);
    expect(body.jsonapi.version).toBe('1.0');
  });

  it('should retrieve a customer', async () => {
    // Create first
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/lemonsqueezy/v1/customers',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Retrieve Test', email: 'retrieve@test.com' }),
    });
    const customerId = createRes.json().data.id;

    const res = await ts.server.inject({
      method: 'GET',
      url: `/lemonsqueezy/v1/customers/${customerId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(customerId);
    expect(body.data.type).toBe('customers');
    expect(body.data.attributes.name).toBe('Retrieve Test');
  });

  it('should update a customer', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/lemonsqueezy/v1/customers',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Update Test', email: 'update@test.com' }),
    });
    const customerId = createRes.json().data.id;

    const res = await ts.server.inject({
      method: 'PATCH',
      url: `/lemonsqueezy/v1/customers/${customerId}`,
      headers: { 'content-type': 'application/vnd.api+json' },
      payload: JSON.stringify({
        data: { type: 'customers', id: customerId, attributes: { city: 'San Francisco' } },
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.attributes.city).toBe('San Francisco');
  });

  it('should return 404 for non-existent customer', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/lemonsqueezy/v1/customers/nonexistent',
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.errors[0].status).toBe('404');
  });

  // ── Products (read-only) ──────────────────────────────────────────────

  it('should list products (empty initially)', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/lemonsqueezy/v1/products',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  // ── Subscriptions ─────────────────────────────────────────────────────

  it('should create and cancel a subscription', async () => {
    // Create
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/lemonsqueezy/v1/subscriptions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ product_name: 'Pro Plan', status: 'active' }),
    });
    expect(createRes.statusCode).toBe(201);
    const subId = createRes.json().data.id;

    // Cancel (DELETE)
    const cancelRes = await ts.server.inject({
      method: 'DELETE',
      url: `/lemonsqueezy/v1/subscriptions/${subId}`,
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().data.attributes.status).toBe('cancelled');
    expect(cancelRes.json().data.attributes.cancelled).toBe(true);
  });

  it('should pause and resume a subscription', async () => {
    // Create
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/lemonsqueezy/v1/subscriptions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ product_name: 'Pause Test', status: 'active' }),
    });
    const subId = createRes.json().data.id;

    // Pause via PATCH
    const pauseRes = await ts.server.inject({
      method: 'PATCH',
      url: `/lemonsqueezy/v1/subscriptions/${subId}`,
      headers: { 'content-type': 'application/vnd.api+json' },
      payload: JSON.stringify({
        data: { type: 'subscriptions', id: subId, attributes: { pause: { mode: 'void' } } },
      }),
    });
    expect(pauseRes.statusCode).toBe(200);
    expect(pauseRes.json().data.attributes.status).toBe('paused');

    // Resume via PATCH (set pause to null)
    const resumeRes = await ts.server.inject({
      method: 'PATCH',
      url: `/lemonsqueezy/v1/subscriptions/${subId}`,
      headers: { 'content-type': 'application/vnd.api+json' },
      payload: JSON.stringify({
        data: { type: 'subscriptions', id: subId, attributes: { pause: null } },
      }),
    });
    expect(resumeRes.statusCode).toBe(200);
    expect(resumeRes.json().data.attributes.status).toBe('active');
  });

  it('should list subscriptions', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/lemonsqueezy/v1/subscriptions',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  // ── Discounts ─────────────────────────────────────────────────────────

  it('should create and delete a discount', async () => {
    // Create
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/lemonsqueezy/v1/discounts',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Summer Sale', code: 'SUMMER20', amount: 20, amount_type: 'percent' }),
    });
    expect(createRes.statusCode).toBe(201);
    const discountId = createRes.json().data.id;

    // List
    const listRes = await ts.server.inject({
      method: 'GET',
      url: '/lemonsqueezy/v1/discounts',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.length).toBeGreaterThan(0);

    // Delete (204 No Content)
    const deleteRes = await ts.server.inject({
      method: 'DELETE',
      url: `/lemonsqueezy/v1/discounts/${discountId}`,
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  // ── Webhooks ──────────────────────────────────────────────────────────

  it('should create, update, and delete a webhook', async () => {
    // Create
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/lemonsqueezy/v1/webhooks',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ url: 'https://example.com/webhook', events: ['order_created'] }),
    });
    expect(createRes.statusCode).toBe(201);
    const webhookId = createRes.json().data.id;

    // Update
    const updateRes = await ts.server.inject({
      method: 'PATCH',
      url: `/lemonsqueezy/v1/webhooks/${webhookId}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ events: ['order_created', 'subscription_created'] }),
    });
    expect(updateRes.statusCode).toBe(200);

    // Delete
    const deleteRes = await ts.server.inject({
      method: 'DELETE',
      url: `/lemonsqueezy/v1/webhooks/${webhookId}`,
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  // ── Checkouts ─────────────────────────────────────────────────────────

  it('should create a checkout', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/lemonsqueezy/v1/checkouts',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ store_id: 1, variant_id: 1 }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.type).toBe('checkouts');
  });

  // ── Users ─────────────────────────────────────────────────────────────

  it('should retrieve the authenticated user', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/lemonsqueezy/v1/users/me',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.type).toBe('users');
    expect(body.data.attributes.name).toBeDefined();
  });

  // ── Pagination ────────────────────────────────────────────────────────

  it('should support page-based pagination', async () => {
    // Create a few customers
    for (let i = 0; i < 3; i++) {
      await ts.server.inject({
        method: 'POST',
        url: '/lemonsqueezy/v1/customers',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: `Page Test ${i}`, email: `page${i}@test.com` }),
      });
    }

    // Request page 1 with size 2
    const res = await ts.server.inject({
      method: 'GET',
      url: '/lemonsqueezy/v1/customers?page[size]=2&page[number]=1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(2);
    expect(body.meta.page.currentPage).toBe(1);
    expect(body.meta.page.perPage).toBe(2);
  });

  // ── License Keys ──────────────────────────────────────────────────────

  it('should list license keys (empty initially)', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/lemonsqueezy/v1/license-keys',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  // ── Seeding ───────────────────────────────────────────────────────────

  it('should serve pre-seeded data', async () => {
    const seedData = new Map([['persona-1', {
      personaId: 'persona-1',
      blueprint: {} as any,
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
                body: { id: 'cust_seed1', name: 'Seeded Customer', email: 'seeded@test.com', status: 'subscribed' },
                personaId: 'persona-1',
                stateKey: 'lemonsqueezy_customers',
              },
            ],
          },
        },
      },
      files: [],
      events: [],
      facts: [],
    }]]);

    const seededAdapter = new LemonSqueezyAdapter();
    const seededTs = await buildTestServer(seededAdapter, seedData);
    const res = await seededTs.server.inject({ method: 'GET', url: '/lemonsqueezy/v1/customers' });
    const items = res.json().data;
    expect(items).toContainEqual(
      expect.objectContaining({
        id: 'cust_seed1',
        attributes: expect.objectContaining({ name: 'Seeded Customer' }),
      }),
    );
    await seededTs.close();
  });
});
