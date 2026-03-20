import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestServer } from '@mimicai/adapter-sdk';
import type { TestServer } from '@mimicai/adapter-sdk';
import { GoCardlessAdapter } from '../gocardless-adapter.js';

describe('GoCardlessAdapter', () => {
  let ts: TestServer;
  const adapter = new GoCardlessAdapter();

  beforeAll(async () => {
    ts = await buildTestServer(adapter);
  });

  afterAll(async () => {
    await ts.close();
  });

  // ── Metadata ────────────────────────────────────────────────────────────────
  it('should have correct metadata', () => {
    expect(adapter.id).toBe('gocardless');
    expect(adapter.basePath).toBe('');
  });

  it('should return endpoint definitions', () => {
    const endpoints = adapter.getEndpoints();
    expect(endpoints.length).toBeGreaterThan(0);
    for (const ep of endpoints) {
      expect(ep.method).toBeDefined();
      expect(ep.path).toBeDefined();
    }
  });

  // ── Customers CRUD ──────────────────────────────────────────────────────────
  it('should create a customer', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'test@example.com', given_name: 'Test', family_name: 'User' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // GoCardless wraps in { customers: {...} }
    expect(body.customers).toBeDefined();
    expect(body.customers.id).toMatch(/^CU/);
    expect(body.customers.email).toBe('test@example.com');
  });

  it('should list customers', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/customers',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.customers).toBeDefined();
    expect(Array.isArray(body.customers)).toBe(true);
    expect(body.customers.length).toBeGreaterThan(0);
    expect(body.meta).toBeDefined();
    expect(body.meta.cursors).toBeDefined();
  });

  it('should retrieve a customer', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'retrieve@example.com', given_name: 'Retrieve' }),
    });
    const customerId = createRes.json().customers.id;

    const res = await ts.server.inject({
      method: 'GET',
      url: `/customers/${customerId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.customers.id).toBe(customerId);
    expect(body.customers.email).toBe('retrieve@example.com');
  });

  it('should update a customer', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'update@example.com', given_name: 'Before' }),
    });
    const customerId = createRes.json().customers.id;

    const res = await ts.server.inject({
      method: 'PUT',
      url: `/customers/${customerId}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ given_name: 'After' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().customers.given_name).toBe('After');
  });

  it('should delete a customer', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'delete@example.com' }),
    });
    const customerId = createRes.json().customers.id;

    const res = await ts.server.inject({
      method: 'DELETE',
      url: `/customers/${customerId}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('should return 404 for non-existent customer', async () => {
    const res = await ts.server.inject({
      method: 'GET',
      url: '/customers/CU_nonexistent',
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('resource_not_found');
  });

  // ── Payments CRUD ───────────────────────────────────────────────────────────
  it('should create and list payments', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/payments',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        amount: 5000,
        currency: 'GBP',
        description: 'Test payment',
        links: { mandate: 'MD_test' },
      }),
    });
    expect(createRes.statusCode).toBe(200);
    const payment = createRes.json().payments;
    expect(payment.id).toMatch(/^PM/);
    expect(payment.amount).toBe(5000);

    const listRes = await ts.server.inject({
      method: 'GET',
      url: '/payments',
    });
    expect(listRes.json().payments.length).toBeGreaterThan(0);
  });

  // ── Mandates ────────────────────────────────────────────────────────────────
  it('should create a mandate and cancel it', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/mandates',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ scheme: 'bacs' }),
    });
    const mandateId = createRes.json().mandates.id;
    expect(mandateId).toMatch(/^MD/);

    // Cancel
    const cancelRes = await ts.server.inject({
      method: 'POST',
      url: `/mandates/${mandateId}/actions/cancel`,
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().mandates.status).toBe('cancelled');

    // Reinstate
    const reinstateRes = await ts.server.inject({
      method: 'POST',
      url: `/mandates/${mandateId}/actions/reinstate`,
    });
    expect(reinstateRes.statusCode).toBe(200);
    expect(reinstateRes.json().mandates.status).toBe('active');
  });

  // ── Subscriptions lifecycle ─────────────────────────────────────────────────
  it('should create and cancel a subscription', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/subscriptions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        amount: 1000,
        currency: 'GBP',
        interval_unit: 'monthly',
        links: { mandate: 'MD_test' },
      }),
    });
    const subId = createRes.json().subscriptions.id;
    expect(subId).toMatch(/^SB/);

    // Cancel
    const cancelRes = await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${subId}/actions/cancel`,
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().subscriptions.status).toBe('cancelled');
  });

  it('should pause and resume a subscription', async () => {
    const createRes = await ts.server.inject({
      method: 'POST',
      url: '/subscriptions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        amount: 2000,
        currency: 'EUR',
        interval_unit: 'monthly',
        status: 'active',
      }),
    });
    const subId = createRes.json().subscriptions.id;

    // Pause
    const pauseRes = await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${subId}/actions/pause`,
    });
    expect(pauseRes.statusCode).toBe(200);
    expect(pauseRes.json().subscriptions.status).toBe('paused');

    // Resume
    const resumeRes = await ts.server.inject({
      method: 'POST',
      url: `/subscriptions/${subId}/actions/resume`,
    });
    expect(resumeRes.statusCode).toBe(200);
    expect(resumeRes.json().subscriptions.status).toBe('active');
  });

  // ── Refunds ─────────────────────────────────────────────────────────────────
  it('should create a refund', async () => {
    const res = await ts.server.inject({
      method: 'POST',
      url: '/refunds',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        amount: 500,
        links: { payment: 'PM_test' },
        total_amount_confirmation: 5000,
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().refunds.id).toMatch(/^RF/);
  });

  // ── Seeding ─────────────────────────────────────────────────────────────────
  it('should serve pre-seeded data', async () => {
    const seedData = new Map([['persona-1', {
      personaId: 'persona-1',
      apiResponses: {
        gocardless: {
          responses: {
            customer: [
              { body: { id: 'CU_seed1', email: 'seeded@test.com', given_name: 'Seeded' } },
            ],
          },
        },
      },
    }]]) as any;

    const seededTs = await buildTestServer(adapter, seedData);
    const res = await seededTs.server.inject({ method: 'GET', url: '/customers' });
    const customers = res.json().customers;
    expect(customers).toContainEqual(expect.objectContaining({ id: 'CU_seed1' }));
    await seededTs.close();
  });
});
